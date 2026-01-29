import { client, COLLECTION_NAME } from "../database/weaviate-client";
import { Metadata, RAGAgentInput, RAGAgentOutput, Reference } from "../types";
import { embeddings } from "../config/llm-config";

/**
 * Executes a RAG (Retrieval-Augmented Generation) query against Weaviate.
 * 
 * Process:
 * 1. Generates an embedding for the user query utilizing the shared Gemini model.
 * 2. Performs a vector search (or keyword fallback) within the tenant's isolated namespace.
 * 3. Formats retrieved document chunks with file IDs and page numbers.
 * 4. Combines the results into a structured answer with references.
 * 
 * @param {RAGAgentInput} input - The query and tenant context.
 * @returns {Promise<RAGAgentOutput>} Structured answer with references and raw data.
 */
export async function queryRAG(input: RAGAgentInput): Promise<RAGAgentOutput> {
    const { query, tenant, topK = 3 } = input;

    try {
        if (!tenant) {
            throw new Error("Tenant is required for multi-tenant collection.");
        }

        console.log(`[RAG] Querying for tenant: ${tenant}, query: ${query}`);

        console.log("[RAG] Generating embedding for query...");
        const vector = await embeddings.embedQuery(query);

        // Attempt vector search with nearVector
        let results;
        try {
            results = await client.graphql
                .get()
                .withClassName(COLLECTION_NAME)
                .withFields("question answer fileId pageNumber")
                .withNearVector({ vector })
                .withTenant(tenant)
                .withLimit(topK)
                .do();
        } catch (e) {
            console.warn("Vector search failed, falling back to fetchObjects API:", e);
            // Use fetchObjects API (client.data.getter) as requested
            const fetchResult = await client.data
                .getter()
                .withClassName(COLLECTION_NAME)
                .withTenant(tenant)
                .withLimit(topK)
                .do();

            const objects = fetchResult.objects || [];
            results = {
                data: {
                    Get: {
                        [COLLECTION_NAME]: objects.map((obj: any) => ({
                            ...obj.properties,
                            _additional: obj.additional
                        }))
                    }
                }
            };
        }

        const objects = (results.data.Get[COLLECTION_NAME] || []) as (Record<string, any> & Metadata)[];

        // Format answer and references
        if (objects.length === 0) {
            return {
                answer: "I couldn't find any relevant information in the documents.",
                references: [],
                rawData: []
            };
        }

        // Accumulate references and build answer context
        const referencesMap: Map<string, Set<string>> = new Map();
        let combinedAnswer = "";
        const fileIdToIndex: Map<string, number> = new Map();
        let fileCounter = 1;

        objects.forEach((obj) => {
            const fileId = obj.fileId;
            if (!fileIdToIndex.has(fileId)) {
                fileIdToIndex.set(fileId, fileCounter++);
            }
            const fileIdx = fileIdToIndex.get(fileId);

            const pages = obj.pageNumber || [];
            if (!referencesMap.has(fileId)) {
                referencesMap.set(fileId, new Set());
            }
            pages.forEach((p: string) => referencesMap.get(fileId)?.add(p));

            combinedAnswer += `${fileIdx}- Page ${pages.join(", ")}: ${obj.answer}\n\n`;
        });

        const references: Reference[] = Array.from(referencesMap.entries()).map(([fileId, pagesSet]) => ({
            fileId,
            pages: Array.from(pagesSet).sort()
        }));

        return {
            answer: combinedAnswer.trim(),
            references,
            rawData: objects
        };
    } catch (error) {
        console.error("Error in RAG agent:", error);
        return {
            answer: "An error occurred while retrieving information.",
            references: [],
            rawData: []
        };
    }
}
