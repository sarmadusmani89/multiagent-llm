import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { routingLLM, llm as sharedLLM } from "../config/llm-config";
import { ChartJSTool } from "../tools/chartjs-tool";
import { queryRAG } from "./rag-agent";
import { ChartJSToolOutput, RAGAgentOutput } from "../types";

// Define the state using Annotation
export const AgentStateAnnotation = Annotation.Root({
    userQuery: Annotation<string>(),
    messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
    }),
    needsChart: Annotation<boolean>(),
    needsRAG: Annotation<boolean>(),
    tenant: Annotation<string | undefined>(),
    chartResult: Annotation<ChartJSToolOutput | undefined>(),
    ragResult: Annotation<RAGAgentOutput | undefined>(),
    finalAnswer: Annotation<string>(),
    allData: Annotation<any[]>({
        reducer: (x, y) => x.concat(y),
        default: () => [],
    }),
});

// Define a type for the state used in the graph
export type GraphState = typeof AgentStateAnnotation.State;

/**
 * Node 1: Delegator Node
 * Analyzes the user query using a high-precision Gemini 2.5 instance.
 * Determines the routing path (Chart, RAG, or Both) and identifies direct-answer queries.
 * Implements a keyword-based fallback if the LLM routing fails or times out.
 */
async function delegatingNode(state: GraphState) {
    const query = state.userQuery.toLowerCase();

    // Try LLM-based routing first with optimized prompt for small models
    try {
        const prompt = `Task: Analyze the query and determine which tools are needed. Return ONLY valid JSON.

Query: "${state.userQuery}"

DECISION RULES:

1. needsChart (Boolean)
   - TRUE if: Query asks to CREATE, GENERATE, SHOW, DISPLAY, VISUALIZE, PLOT, or DRAW any chart, graph, diagram, or visual representation
   - Keywords: "chart", "graph", "plot", "visualize", "show data", "display trends"
   - FALSE otherwise

2. needsRAG (Boolean)
   - TRUE if: Query asks WHAT, WHY, HOW, WHEN, WHERE, WHO or requests INFORMATION, EXPLANATION, DETAILS, or SUMMARY from documents/knowledge base
   - Keywords: "what is", "how does", "explain", "tell me about", "find information", "search for", "describe"
   - FALSE if: Query is ONLY asking to create a chart OR is a simple calculation

3. directAnswer (String | null)
   - Provide a direct answer for ANY query that doesn't need specific tools:
     * Greetings: "Hello", "Hi", "Who are you?"
     * Basic math: "What is 5 + 3?"
     * Simple facts: "What is the capital of France?"
     * General knowledge: "How many planets are in the solar system?"
   - Set to null ONLY if:
     * Question requires searching through documents (needsRAG = true)
     * Question requires generating a visualization (needsChart = true)
     * The query is complex and would be better answered by the aggregator node with full context

EXAMPLES:

"Create a bar chart of quarterly sales"
→ {"needsChart": true, "needsRAG": false, "directAnswer": null}

"What are the system requirements in the documentation?"
→ {"needsChart": false, "needsRAG": true, "directAnswer": null}

"Show me a revenue chart and explain the trends"
→ {"needsChart": true, "needsRAG": true, "directAnswer": null}

"Calculate 15 + 27"
→ {"needsChart": false, "needsRAG": false, "directAnswer": "42"}

"What is the capital of France?"
→ {"needsChart": false, "needsRAG": false, "directAnswer": "Paris"}

"Explain how photosynthesis works"
→ {"needsChart": false, "needsRAG": true, "directAnswer": null}

"What does the contract say about termination?"
→ {"needsChart": false, "needsRAG": true, "directAnswer": null}

"Plot the sales data"
→ {"needsChart": true, "needsRAG": false, "directAnswer": null}

"What is 100 divided by 4?"
→ {"needsChart": false, "needsRAG": false, "directAnswer": "25"}

CRITICAL: Return ONLY valid JSON with this exact structure:
{"needsChart": boolean, "needsRAG": boolean, "directAnswer": string | null}

Your response:
`;

        const response = await routingLLM.invoke([new HumanMessage(prompt)]);
        let content = response.content.toString().trim();

        // Clean up markdown code blocks if present
        if (content.includes('```')) {
            content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        }

        // Try to parse LLM response
        const decision = JSON.parse(content);

        // Validate the decision has required fields
        if (typeof decision.needsChart === 'boolean' && typeof decision.needsRAG === 'boolean') {
            console.log(`[LLM Routing] Chart: ${decision.needsChart}, RAG: ${decision.needsRAG}, Direct: ${!!decision.directAnswer}`);
            return {
                needsChart: decision.needsChart,
                needsRAG: decision.needsRAG,
                finalAnswer: decision.directAnswer || "",
            };
        } else {
            throw new Error('Invalid decision structure from LLM');
        }

    } catch (error) {
        // Fallback to keyword-based routing
        console.warn('[LLM Routing Failed] Using keyword-based fallback:', error instanceof Error ? error.message : 'Unknown error');

        const chartKeywords = /chart|graph|visuali[sz]e|plot|bar|line|pie|doughnut|show\s+me\s+a\s+(chart|graph)/;
        const mathPattern = /(\d+)\s*[\+\-\*\/]\s*(\d+)/;
        const ragKeywords = /(what\s+(is|are|was|were)|how\s+(do|does|did)|tell\s+me\s+about)\s+.*(system|requirement|document|policy|authentication|safety|concern|driver|cost)/;
        const documentKeywords = /mentioned\s+in|from\s+the\s+document|in\s+the\s+documentation/;
        const explainPattern = /and\s+explain|explain\s+the/;

        const needsChart = chartKeywords.test(query);
        const needsRAG = ((ragKeywords.test(query) || documentKeywords.test(query) || explainPattern.test(query)) && !mathPattern.test(query));

        // Handle direct math questions
        const mathMatch = query.match(mathPattern);
        let directAnswer = "";

        if (mathMatch && !needsChart && !needsRAG) {
            const num1 = parseFloat(mathMatch[1]);
            const num2 = parseFloat(mathMatch[2]);
            const operator = mathMatch[0].match(/[\+\-\*\/]/)?.[0];

            let result = 0;
            switch (operator) {
                case '+': result = num1 + num2; break;
                case '-': result = num1 - num2; break;
                case '*': result = num1 * num2; break;
                case '/': result = num1 / num2; break;
            }

            directAnswer = `The answer is ${result}.`;
        }

        console.log(`[Keyword Fallback] Chart: ${needsChart}, RAG: ${needsRAG}, Direct: ${!!directAnswer}`);

        return {
            needsChart,
            needsRAG,
            finalAnswer: directAnswer,
        };
    }
}

/**
 * Node 2: Chart Tool Node
 * Invokes the mock ChartJSTool if the delegator flagged a need for visualization.
 * Maps natural language descriptions into structured Chart.js configurations.
 */
async function chartToolNode(state: GraphState) {
    if (!state.needsChart) return {};

    const chartTool = new ChartJSTool();
    const query = state.userQuery.toLowerCase();

    // Determine chart type from keywords
    let chartType: "bar" | "line" | "pie" | "doughnut" = "bar";
    if (/line/.test(query)) chartType = "line";
    else if (/pie/.test(query)) chartType = "pie";
    else if (/doughnut/.test(query)) chartType = "doughnut";

    const params = {
        chartType,
        description: state.userQuery
    };
    const resultStr = await chartTool.invoke(params);
    const chartResult = JSON.parse(resultStr) as ChartJSToolOutput;

    return {
        chartResult,
        allData: [chartResult]
    };
}

/**
 * Node 3: RAG Agent Node
 * Searches the Weaviate vector database for context-specific information.
 * Ensures strict tenant isolation and uses shared embeddings for consistency.
 */
async function ragAgentNode(state: GraphState) {
    if (!state.needsRAG) return {};

    try {
        const ragResult = await queryRAG({
            query: state.userQuery,
            tenant: state.tenant || "company_a"
        });

        return {
            ragResult,
            allData: [ragResult.references]
        };
    } catch (error) {
        console.error("[Delegator] RAG Node Error:", error);
        return {
            ragResult: {
                answer: "I encountered an error while searching for document information.",
                references: [],
                rawData: []
            }
        };
    }
}

/**
 * Node 4: Aggregator Node
 * Synthesizes data from both RAG and Chart nodes into a final, coherent answer.
 * Uses a creative temperature setting to produce helpful, context-aware responses.
 */
async function aggregatorNode(state: GraphState) {
    if (state.finalAnswer) return {};

    try {
        let contextualPrompt = `You are a helpful assistant. Based on the following information, answer the user's query: "${state.userQuery}"\n\n`;

        if (state.ragResult) {
            contextualPrompt += `Document Information:\n${state.ragResult.answer}\n\n`;
        }

        if (state.chartResult) {
            contextualPrompt += `I have also generated a ${state.chartResult.type} chart for "${state.chartResult.description}".\n\n`;
        }

        const response = await sharedLLM.invoke([new HumanMessage(contextualPrompt)]);

        return {
            finalAnswer: response.content.toString()
        };
    } catch (error) {
        console.error("[Delegator] Aggregator Node Error:", error);
        return {
            finalAnswer: "I'm sorry, I encountered an error while synthesizing your answer. However, I have gathered the requested data."
        };
    }
}

// Define the graph
const workflow = new StateGraph(AgentStateAnnotation)
    .addNode("delegator", delegatingNode)
    .addNode("chart", chartToolNode)
    .addNode("rag", ragAgentNode)
    .addNode("aggregator", aggregatorNode)
    .addEdge(START, "delegator");

workflow.addConditionalEdges(
    "delegator",
    (state) => {
        if (state.finalAnswer) return "end";
        if (state.needsChart && state.needsRAG) return ["chart", "rag"];
        if (state.needsChart) return "chart";
        if (state.needsRAG) return "rag";
        return "aggregator";
    },
    {
        chart: "chart",
        rag: "rag",
        aggregator: "aggregator",
        end: END
    }
);

workflow.addEdge("chart", "aggregator");
workflow.addEdge("rag", "aggregator");
workflow.addEdge("aggregator", END);

export const graph = workflow.compile();
