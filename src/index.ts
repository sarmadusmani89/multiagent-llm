import { graph, GraphState } from "./agents/delegating-agent";
import { setupWeaviate } from "./database/weaviate-setup";
import { StreamingResponse } from "./types";
import { HumanMessage } from "@langchain/core/messages";
import * as dotenv from "dotenv";

dotenv.config();

async function runQuery(query: string, tenant: string = "company_a") {
    console.log(`\n--- RUNNING QUERY: "${query}" (Tenant: ${tenant}) ---`);
    const startTime = Date.now();

    const initialState = {
        userQuery: query,
        messages: [new HumanMessage(query)],
        needsChart: false,
        needsRAG: false,
        tenant: tenant,
        finalAnswer: "",
        allData: []
    };

    try {
        const stream = await graph.stream(initialState, {
            streamMode: "values"
        });

        let lastState: GraphState | null = null;

        for await (const chunk of stream) {
            lastState = chunk as GraphState;
            if (chunk.finalAnswer) {
                // Clear line and print (simple mock for streaming)
                process.stdout.write(`\rAssistant: ${chunk.finalAnswer}\n`);
            }
        }

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        if (lastState) {
            const response: StreamingResponse = {
                answer: lastState.finalAnswer,
                data: lastState.allData
            };
            console.log(`\n[Latency: ${duration.toFixed(2)}s]`);
            console.log("Final Data Payload:", JSON.stringify(response.data, null, 2));
        }

    } catch (error) {
        console.error("Error running graph:", error);
    }
}

async function main() {
    // Check if we should setup DB
    if (process.argv.includes("--setup-db")) {
        console.log("Setting up Weaviate...");
        try {
            await setupWeaviate();
        } catch (e) {
            console.error("Failed to setup Weaviate (is Docker running?):", e);
        }
    }

    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

    // NOTE: Using delays to avoid hitting Gemini API Free Tier rate limits (15 RPM)
    // In a production environment, you would use a proper task queue or rate limiter.

    // Test Case 1: Chart Only
    await runQuery("Create a bar chart showing quarterly revenue from Q1 to Q4");
    await delay(3000);

    // Test Case 2: RAG Only
    await runQuery("What are the system requirements mentioned in the documentation?", "company_a");
    await delay(3000);

    // Test Case 3: Both Tools
    await runQuery("Show me a chart of Q3 revenue and explain the growth drivers", "company_b");
    await delay(3000);

    // Test Case 4: Direct Answer - Fact
    await runQuery("What is the capital of France?");
    await delay(3000);
}

main().catch(console.error);
