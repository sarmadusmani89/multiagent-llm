import { client, COLLECTION_NAME } from "./weaviate-client";
import { embeddings } from "../config/llm-config";

const seedData = [
    {
        tenant: "company_a",
        fileId: "tech_doc_001",
        question: "What are the system requirements for deployment?",
        answer: "The system requires Node.js 18+, 4GB RAM minimum, and Docker installed. PostgreSQL 14+ is needed for the database.",
        pageNumber: ["3", "4"]
    },
    {
        tenant: "company_a",
        fileId: "tech_doc_001",
        question: "How is authentication handled?",
        answer: "Authentication uses JWT tokens with OAuth2.0 integration. Tokens expire after 24 hours and refresh tokens are valid for 30 days.",
        pageNumber: ["12", "13", "14"]
    },
    {
        tenant: "company_b",
        fileId: "financial_report_q3",
        question: "What was the revenue for Q3 2024?",
        answer: "Q3 2024 revenue reached $4.2 million, representing a 23% increase year-over-year driven by enterprise subscription growth.",
        pageNumber: ["7"]
    },
    {
        tenant: "company_b",
        fileId: "financial_report_q3",
        question: "What are the main cost drivers?",
        answer: "Primary costs include cloud infrastructure (35%), personnel (45%), and marketing (20%). R&D investment increased by 15% this quarter.",
        pageNumber: ["15", "16"]
    },
    {
        tenant: "research_team",
        fileId: "ai_safety_paper_v2",
        question: "What are the key AI safety concerns identified?",
        answer: "The paper identifies three critical concerns: alignment issues with human values, potential for unintended behaviors at scale, and challenges in interpretability of large models.",
        pageNumber: ["2", "3", "8"]
    }
];

/**
 * Checks if the Weaviate service is ready to accept connections.
 * @returns {Promise<boolean>}
 */
async function isWeaviateReady(): Promise<boolean> {
    try {
        await client.misc.readyChecker().do();
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Initializes the Weaviate database:
 * 1. Waits for the service to be ready.
 * 2. Deletes the existing collection if it exists.
 * 3. Creates a new multi-tenant collection.
 * 4. Seeds the database with fictional technical and financial data.
 */
export async function setupWeaviate() {
    try {
        console.log("Checking Weaviate health...");
        let retries = 5;
        while (!(await isWeaviateReady()) && retries > 0) {
            console.log(`Weaviate not ready. Retrying in 2s... (${retries} retries left)`);
            await new Promise(res => setTimeout(res, 2000));
            retries--;
        }

        if (retries === 0) {
            throw new Error("Weaviate service not responsive after multiple retries.");
        }


        // Check if class exists
        const schema = await client.schema.getter().do();
        const classExists = schema.classes?.find(c => c.class === COLLECTION_NAME);

        if (classExists) {
            console.log(`Collection ${COLLECTION_NAME} already exists. Deleting...`);
            await client.schema.classDeleter().withClassName(COLLECTION_NAME).do();
        }

        console.log(`Creating collection ${COLLECTION_NAME} with multi-tenancy enabled (vectorizer: none)...`);
        await client.schema
            .classCreator()
            .withClass({
                class: COLLECTION_NAME,
                multiTenancyConfig: { enabled: true },
                vectorizer: "none",
                properties: [
                    {
                        name: "fileId",
                        dataType: ["text"],
                        indexFilterable: true,
                        indexSearchable: false,
                    },
                    {
                        name: "question",
                        dataType: ["text"],
                        indexFilterable: true,
                        indexSearchable: true,
                    },
                    {
                        name: "answer",
                        dataType: ["text"],
                        indexFilterable: true,
                        indexSearchable: true,
                    },
                    {
                        name: "pageNumber",
                        dataType: ["text[]"],
                        indexFilterable: true,
                        indexSearchable: false,
                    },
                ],
            })
            .do();

        console.log("Seeding data...");

        // Group by tenant
        const tenants = [...new Set(seedData.map(d => d.tenant))];

        // Add tenants
        await client.schema
            .tenantsCreator(COLLECTION_NAME, tenants.map(t => ({ name: t })))
            .do();

        // Insert data
        for (const data of seedData) {
            const { tenant, ...rest } = data;

            console.log(`Generating embedding for: "${data.question}"`);
            const vector = await embeddings.embedQuery(data.question);

            await client.data
                .creator()
                .withClassName(COLLECTION_NAME)
                .withTenant(tenant)
                .withProperties(rest)
                .withVector(vector)
                .do();
        }

        console.log("Weaviate setup complete.");
    } catch (error) {
        console.error("Error setting up Weaviate:", error);
        throw error;
    }
}

if (require.main === module) {
    setupWeaviate();
}
