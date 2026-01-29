import { BaseMessage } from "@langchain/core/messages";

export interface ChartJSToolInput {
    chartType: string;
    description: string;
    dataPoints?: number;
}

export interface ChartJSToolOutput {
    type: string;
    chartConfig: object;
    description: string;
}

export interface RAGAgentInput {
    query: string;
    tenant?: string;
    topK?: number;
}

export interface Reference {
    fileId: string;
    pages: string[];
}

export interface Metadata {
    fileId: string;
    pageNumber: string[];
}

export interface RAGAgentOutput {
    answer: string;
    references: Reference[];
    rawData: (Record<string, any> & Metadata)[];
}

export interface AgentState {
    userQuery: string;
    messages: BaseMessage[];
    needsChart: boolean;
    needsRAG: boolean;
    tenant?: string;
    chartResult?: ChartJSToolOutput;
    ragResult?: RAGAgentOutput;
    finalAnswer: string;
    allData: (ChartJSToolOutput | Reference[] | Record<string, any>)[];
    [key: string]: any;
}

export interface StreamingResponse {
    answer: string;
    data: any[];
}
