import { ChangeDetectionStrategy, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { mxgraph } from 'mxgraph'; // Typings only - no code!
import { IContainer } from '../../../../../../../model/IContainer';
import { IModelConnection } from '../../../../../../../model/IModelConnection';
import { IModelNode } from '../../../../../../../model/IModelNode';
import { Id } from '../../../../../../../util/id';
import { Url } from '../../../../../../../util/url';
import { SpecmateDataService } from '../../../../../../data/modules/data-service/services/specmate-data.service';
import { ValidationService } from '../../../../../../forms/modules/validation/services/validation.service';
import { SelectedElementService } from '../../../../../side/modules/selected-element/services/selected-element.service';
import { ConverterBase } from '../converters/converter-base';
import { NodeNameConverterProvider } from '../providers/conversion/node-name-converter-provider';
import { ElementProvider } from '../providers/properties/element-provider';
import { NameProvider } from '../providers/properties/name-provider';
import { ShapeData, ShapeProvider } from '../providers/properties/shape-provider';
import { ToolProvider } from '../providers/properties/tool-provider';
import { ChangeTranslator } from './util/change-translator';
import { StyleChanger } from './util/style-changer';


declare var require: any;

const mx: typeof mxgraph = require('mxgraph')({
    mxBasePath: 'mxgraph'
});



@Component({
    moduleId: module.id.toString(),
    selector: 'graphical-editor',
    templateUrl: 'graphical-editor.component.html',
    styleUrls: ['graphical-editor.component.css'],
    changeDetection: ChangeDetectionStrategy.Default
})
export class GraphicalEditor {

    private nameProvider: NameProvider;
    private elementProvider: ElementProvider;
    private toolProvider: ToolProvider;
    private nodeNameConverter: ConverterBase<any, string>;
    private shapeProvider: ShapeProvider;
    private changeTranslator: ChangeTranslator;

    public isGridShown = true;

    private _model: IContainer;
    private _contents: IContainer[];
    private readonly VALID_STYLE_NAME = 'VALID';
    private readonly INVALID_STYLE_NAME = 'INVALID';

    constructor(
        private dataService: SpecmateDataService,
        private selectedElementService: SelectedElementService,
        private validationService: ValidationService,
        private translate: TranslateService) {
        this.validationService.validationFinished.subscribe(() => {
            this.updateValidities();
        });
    }

    private graph: mxgraph.mxGraph;
    private keyHandler: mxgraph.mxKeyHandler;

    @ViewChild('mxGraphContainer')
    public set graphContainer(element: ElementRef) {

        mx.mxConnectionHandler.prototype.connectImage = new mx.mxImage('/assets/img/editor-tools/connector.png', 16, 16);
        mx.mxEvent.disableContextMenu(document.body);
        mx.mxGraphHandler.prototype['guidesEnabled'] = true;

        if (element === undefined) {
            return;
        }

        this.graph = new mx.mxGraph(element.nativeElement);
        this.graph.setGridEnabled(true);
        this.graph.setConnectable(true);
        this.graph.setMultigraph(false);
        const rubberBand = new mx.mxRubberband(this.graph);
        rubberBand.reset();

        this.graph.setTooltips(true);

        this.graph.getModel().addListener(mx.mxEvent.CHANGE, async (sender: mxgraph.mxEventSource, evt: mxgraph.mxEventObject) => {
            const edit = evt.getProperty('edit') as mxgraph.mxUndoableEdit;
            const changes = edit.changes;

            try {
                for (const change of changes) {
                    await this.changeTranslator.translate(change).catch(() => {
                        this.changeTranslator.preventDataUpdates = true;
                        edit.undo();
                        this.changeTranslator.preventDataUpdates = false;
                    });
                }
            } catch (e) {
                console.error(e);
            }
        });

        this.graph.getSelectionModel().addListener(mx.mxEvent.CHANGE, async (args: any) => {
            if (this.graph.getSelectionCount() === 1) {
                const selectedElement = await this.dataService.readElement(this.graph.getSelectionModel().cells[0].getId(), true);
                this.selectedElementService.select(selectedElement);
            } else {
                this.selectedElementService.deselect();
            }
        });

        this.init();
    }

    private async init(): Promise<void> {
        if (this.graph === undefined || this.model === undefined) {
            return;
        }
        this.initStyles();
        this.initKeyHandler();
        this.initGraphicalModel();
        this.initTools();
    }

    private provideVertex(node: IModelNode, x?: number, y?: number): mxgraph.mxCell {
        const width = this.shapeProvider.getInitialSize(node).width;
        const height = this.shapeProvider.getInitialSize(node).height;
        const value = this.nodeNameConverter ? this.nodeNameConverter.convertTo(node) : node.name;
        const style = this.shapeProvider.getStyle(node);
        const parent = this.graph.getDefaultParent();
        const vertex = this.graph.insertVertex(parent, node.url, value, x || node.x, y || node.y, width, height, style);
        return vertex;
    }

    private initStyles(): void {


        console.log(mx.mxConstants);

        mx.mxConstants.HANDLE_FILLCOLOR = '#99ccff';
        mx.mxConstants.HANDLE_STROKECOLOR = '#0088cf';
        mx.mxConstants.VERTEX_SELECTION_COLOR = '#00a8ff';
        mx.mxConstants.EDGE_SELECTION_COLOR = '#00a8ff';
        mx.mxConstants.DEFAULT_FONTSIZE = 16;

        const stylesheet = this.graph.getStylesheet();
        const validStyle: {
            [key: string]: string;
        } = {};
        validStyle[mx.mxConstants.STYLE_OPACITY] = '75';
        validStyle[mx.mxConstants.STYLE_FILLCOLOR] = '#c3d9ff';
        validStyle[mx.mxConstants.STYLE_STROKE_OPACITY] = '100';
        validStyle[mx.mxConstants.STYLE_STROKECOLOR] = '#c3d9ff';
        stylesheet.putCellStyle(this.VALID_STYLE_NAME, validStyle);
        const invalidStyle: {
            [key: string]: string;
        } = {};
        invalidStyle[mx.mxConstants.STYLE_OPACITY] = '75';
        invalidStyle[mx.mxConstants.STYLE_FILLCOLOR] = '#ffc3d9';
        invalidStyle[mx.mxConstants.STYLE_STROKE_OPACITY] = '100';
        invalidStyle[mx.mxConstants.STYLE_STROKECOLOR] = '#ffc3d9';
        stylesheet.putCellStyle(this.INVALID_STYLE_NAME, invalidStyle);
        const vertexStyle = this.graph.getStylesheet().getDefaultVertexStyle();
        vertexStyle[mx.mxConstants.STYLE_STROKECOLOR] = '#000000';
        this.graph.getStylesheet().getDefaultEdgeStyle()[mx.mxConstants.STYLE_STROKECOLOR] = '#000000';
    }

    private initKeyHandler(): void {
        this.keyHandler = new mx.mxKeyHandler(this.graph);

        // Del
        this.keyHandler.bindKey(46, (evt: KeyboardEvent) => {
            this.stopEvent(evt);
            this.deleteSelectedCells();
        });

        // Backspace
        this.keyHandler.bindControlKey(8, (evt: KeyboardEvent) => {
            this.deleteSelectedCells();
        });

        // Ctrl+A
        this.keyHandler.bindControlKey(65, (evt: KeyboardEvent) => {
            this.stopEvent(evt);
            if (this.graph.isEnabled()) {
                this.graph.getSelectionModel().addCells(this.graph.getChildCells(this.graph.getDefaultParent()));
            }
        });
    }

    private stopEvent(evt: Event): void {
        evt.preventDefault();
        evt.stopPropagation();
    }

    private deleteSelectedCells(): void {
        if (this.graph.isEnabled()) {
            const selectedCells = this.graph.getSelectionCells().filter(cell => !cell.edge);
            this.graph.removeCells(selectedCells, true);
        }
    }

    private async initGraphicalModel(): Promise<void> {
        this._contents = await this.dataService.readContents(this.model.url, true);
        this.elementProvider = new ElementProvider(this.model, this._contents);
        this.nodeNameConverter = new NodeNameConverterProvider(this.model).nodeNameConverter;
        const parent = this.graph.getDefaultParent();
        this.changeTranslator.preventDataUpdates = true;
        this.graph.getModel().beginUpdate();
        try {

            const vertexCache: { [url: string]: mxgraph.mxCell } = {};
            for (const node of this.elementProvider.nodes) {
                const vertex = this.provideVertex(node as IModelNode);
                vertexCache[node.url] = vertex;
            }
            for (const connection of this.elementProvider.connections.map(element => element as IModelConnection)) {
                const sourceVertex = vertexCache[connection.source.url];
                const targetVertex = vertexCache[connection.target.url];
                const value = this.nodeNameConverter ? this.nodeNameConverter.convertTo(connection) : connection.name;
                this.graph.insertEdge(parent, connection.url, value, sourceVertex, targetVertex);
            }

        } finally {
            this.graph.getModel().endUpdate();
            this.changeTranslator.preventDataUpdates = false;
        }
    }

    private async initTools(): Promise<void> {
        this.graph.setDropEnabled(true);
        const tools = this.toolProvider.tools;

        for (const tool of tools.filter(t => t.isVertexTool === true)) {
            const onDrop = (graph: mxgraph.mxGraph, evt: MouseEvent, cell: mxgraph.mxCell) => {
                this.graph.stopEditing(false);
                const initialData: ShapeData = this.shapeProvider.getInitialData(tool.style);
                const coords = graph.getPointForEvent(evt);
                const vertexUrl = Url.build([this.model.url, Id.uuid]);
                this.graph.startEditing(evt);
                this.graph.insertVertex(
                    this.graph.getDefaultParent(),
                    vertexUrl,
                    initialData.text,
                    coords.x, coords.y,
                    initialData.size.width, initialData.size.height,
                    initialData.style);
                this.graph.stopEditing(true);
            };
            mx.mxUtils.makeDraggable(document.getElementById(tool.elementId), this.graph, onDrop);
        }
    }

    private updateValidities(): void {
        if (this.graph === undefined) {
            return;
        }
        const vertices = this.graph.getModel().getChildVertices(this.graph.getDefaultParent());
        for (const vertex of vertices) {
            StyleChanger.addStyle(vertex, this.graph, this.VALID_STYLE_NAME);
        }
        const invalidNodes = this.validationService.getValidationResults(this.model);
        for (const invalidNode of invalidNodes) {
            const vertexId = invalidNode.element.url;
            const vertex = vertices.find(vertex => vertex.id === vertexId);
            StyleChanger.replaceStyle(vertex, this.graph, this.VALID_STYLE_NAME, this.INVALID_STYLE_NAME);
        }
    }

    public get model(): IContainer {
        return this._model;
    }


    @Input()
    public set model(model: IContainer) {
        this.toolProvider = new ToolProvider(model, this.dataService, this.selectedElementService);
        this.shapeProvider = new ShapeProvider(model);
        this.nameProvider = new NameProvider(model, this.translate);
        this.changeTranslator = new ChangeTranslator(model, this.dataService, this.toolProvider);
        this._model = model;
    }

    @Input()
    public set contents(contents: IContainer[]) {
        this._contents = contents;
        this.elementProvider = new ElementProvider(this.model, this._contents);
    }

    public get contents(): IContainer[] {
        return this._contents;
    }

    public get isValid(): boolean {
        return this.validationService.isValid(this.model);
    }

    public zoomIn(): void {
        this.graph.zoomIn();
    }

    public zoomOut(): void {
        this.graph.zoomOut();
    }

    public resetZoom(): void {
        this.graph.zoomActual();
    }

    public showGrid(): void {
        this.isGridShown = true;
    }

    public hideGrid(): void {
        this.isGridShown = false;
    }

    public get connections(): IContainer[] {
        if (!this.elementProvider) {
            return [];
        }
        return this.elementProvider.connections;
    }

    public get nodes(): IContainer[] {
        if (!this.elementProvider) {
            return [];
        }
        return this.elementProvider.nodes;
    }

    public get name(): string {
        if (!this.nameProvider) {
            return '';
        }
        return this.nameProvider.name;
    }
}
