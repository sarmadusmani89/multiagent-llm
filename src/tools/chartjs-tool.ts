import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ChartJSToolOutput } from "../types";

export class ChartJSTool extends StructuredTool {
    name = "chartjs_generator";
    description = "Generates a Chart.js configuration based on a natural language description and chart type.";

    schema = z.object({
        chartType: z.enum(["bar", "line", "pie", "doughnut"]).describe("The type of chart to generate"),
        description: z.string().describe("What the chart should represent"),
        dataPoints: z.number().optional().describe("Number of data points to generate (default 4)"),
    });

    /**
     * Executes the chart generation logic.
     * Mocks realistic financial or growth data based on the user's description.
     * 
     * @param {input} input - Structured input containing chart type and description.
     * @returns {Promise<string>} Stringified JSON of the ChartJSToolOutput.
     */
    async _call(input: z.infer<typeof this.schema>): Promise<string> {
        const { chartType, description, dataPoints = 4 } = input;

        // Mock realistic data based on description
        let labels: string[] = [];
        let data: number[] = [];
        let datasetLabel = "Value";

        if (description.toLowerCase().includes("revenue") || description.toLowerCase().includes("quarterly")) {
            labels = ["Q1", "Q2", "Q3", "Q4"];
            data = [120000, 150000, 180000, 200000];
            datasetLabel = "Revenue ($)";
        } else if (description.toLowerCase().includes("growth") || description.toLowerCase().includes("trend")) {
            labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
            data = [10, 25, 45, 30, 55, 78];
            datasetLabel = "Growth (%)";
        } else if (description.toLowerCase().includes("share") || description.toLowerCase().includes("market")) {
            labels = ["Product A", "Product B", "Product C", "Others"];
            data = [40, 30, 20, 10];
            datasetLabel = "Market Share (%)";
        } else {
            labels = Array.from({ length: dataPoints }, (_, i) => `Label ${i + 1}`);
            data = Array.from({ length: dataPoints }, () => Math.floor(Math.random() * 100));
        }

        const chartConfig = {
            type: chartType,
            data: {
                labels,
                datasets: [{
                    label: datasetLabel,
                    data,
                    backgroundColor: chartType === 'pie' || chartType === 'doughnut'
                        ? ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0']
                        : '#36A2EB',
                    borderColor: '#36A2EB',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'top' as const },
                    title: { display: true, text: description }
                }
            }
        };

        const output: ChartJSToolOutput = {
            type: chartType,
            chartConfig,
            description
        };

        return JSON.stringify(output);
    }
}
