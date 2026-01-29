import weaviate, { WeaviateClient } from "weaviate-ts-client";
import * as dotenv from "dotenv";

dotenv.config();

const rawUrl = process.env.WEAVIATE_URL || "http://localhost:8080";
const sanitizedHost = rawUrl
    .replace(/^https?:\/\//, "") // Remove protocol
    .replace(/\/$/, "");         // Remove trailing slash

export const client: WeaviateClient = weaviate.client({
    scheme: rawUrl.startsWith("https") ? "https" : "http",
    host: sanitizedHost,
});

export const COLLECTION_NAME = "DocumentQA";
