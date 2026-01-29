import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { TaskType } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not set in environment variables");
}

/**
 * Shared LLM instance for general chat and aggregation (Higher temperature for creativity)
 */
export const llm = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey,
    temperature: 0.7,
});

/**
 * Optimized LLM instance for routing and classification (Lower temperature for consistency)
 */
export const routingLLM = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey,
    temperature: 0.1,
});

/**
 * Shared embeddings instance for RAG and search
 */
export const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "gemini-embedding-001",
    apiKey,
    taskType: TaskType.RETRIEVAL_DOCUMENT, // Default; overridden in specific agents if needed
});
