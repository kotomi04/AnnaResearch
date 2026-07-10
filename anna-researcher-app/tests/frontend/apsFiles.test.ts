import { describe, expect, it } from "vitest";
import { getResearchFileDownloadDescriptors } from "../../src/api/apsFiles";
import type { AnnaAgentApi, AnnaFilesApi } from "../../src/types";

describe("APS file descriptors", () => {
  it("analyzes image attachments through an agent session using the download URL", async () => {
    const prompts: string[] = [];
    const filesApi: AnnaFilesApi = {
      async upload_init() {
        throw new Error("not used");
      },
      async upload_finalize() {
        throw new Error("not used");
      },
      async download_url() {
        return { get_url: "https://files.example/research-chart.png?sig=123" };
      },
      async list() {
        return { items: [] };
      },
    };
    const agentApi: AnnaAgentApi = {
      async session() {
        return {
          async *run(input) {
            prompts.push(input.content);
            yield {
              choices: [
                {
                  delta: {
                    content: JSON.stringify({
                      image_type: "chart",
                      summary: "A line chart comparing quarterly revenue.",
                      detailed_description: "The image shows a line moving upward across labeled quarters.",
                      visible_text: [{ text: "Revenue Q1 Q2", location: "chart labels", confidence: "medium" }],
                      key_observations: [{ observation: "Revenue rises across the chart.", evidence: "The line slopes upward.", confidence: "high" }],
                      chart_or_table: { is_chart_or_table: true, type: "line_chart", visual_trends: ["upward trend"] },
                      research_relevance: { relevance: "Useful as visual evidence for revenue trend discussion.", relevance_score: 0.82 },
                      uncertainties: ["Exact axis values are too small to read."],
                      extraction_limits: ["Cannot verify the source from the image alone."],
                    }),
                  },
                },
              ],
            };
            yield { event: "raw", text: "[DONE]" };
            yield { event: "complete" };
          },
          async delete() {
            return {};
          },
        };
      },
    };

    const descriptors = await getResearchFileDownloadDescriptors({
      filesApi,
      agentApi,
      researchQuery: "quarterly revenue trend",
      attachments: [
        {
          name: "research-chart.png",
          path: "research-jobs/r1/uploads/research-chart.png",
          content_type: "image/png",
          size_bytes: 1200,
        },
      ],
    });

    expect(prompts[0]).toContain("analyze_image");
    expect(prompts[0]).toContain("Research query: quarterly revenue trend");
    expect(prompts[0]).toContain("relevance_score");
    expect(prompts[0]).toContain("number from 0 to 1");
    expect(prompts[0]).toContain("After the tool call, your final answer MUST be exactly one JSON object");
    expect(prompts[0]).toContain("The response MUST start with `{` and end with `}`");
    expect(prompts[0]).toContain("The response MUST be parseable by JSON.parse");
    expect(prompts[0]).toContain("Set research_relevance.relevance_score from 0 to 1");
    expect(prompts[0]).toContain("https://files.example/research-chart.png?sig=123");
    expect(prompts[0]).toContain("Do not use `upload_local_file`");
    expect(descriptors[0].image_analysis?.summary).toBe("A line chart comparing quarterly revenue.");
    expect(descriptors[0].image_analysis?.key_observations).toEqual([{ observation: "Revenue rises across the chart.", evidence: "The line slopes upward.", confidence: "high" }]);
    expect(descriptors[0].image_analysis?.raw_text).not.toContain("[DONE]");
    expect(descriptors[0].image_analysis_error).toBeUndefined();
  });

  it("collects image analysis JSON from agent message content frames", async () => {
    const filesApi: AnnaFilesApi = {
      async upload_init() {
        throw new Error("not used");
      },
      async upload_finalize() {
        throw new Error("not used");
      },
      async download_url() {
        return { get_url: "https://files.example/research-screenshot.png?sig=123" };
      },
      async list() {
        return { items: [] };
      },
    };
    const agentApi: AnnaAgentApi = {
      async session() {
        return {
          async *run() {
            yield {
              event: "message",
              message: {
                content: [
                  {
                    text: JSON.stringify({
                      image_type: "screenshot",
                      summary: "A screenshot showing a stock chart.",
                      research_relevance: { relevance: "Related to the stock research query.", relevance_score: 0.7 },
                    }),
                  },
                ],
              },
            };
            yield { event: "complete" };
          },
          async delete() {
            return {};
          },
        };
      },
    };

    const descriptors = await getResearchFileDownloadDescriptors({
      filesApi,
      agentApi,
      researchQuery: "stock trend",
      attachments: [
        {
          name: "research-screenshot.png",
          path: "research-jobs/r1/uploads/research-screenshot.png",
          content_type: "image/png",
          size_bytes: 1200,
        },
      ],
    });

    expect(descriptors[0].image_analysis?.summary).toBe("A screenshot showing a stock chart.");
    expect(descriptors[0].image_analysis_error).toBeUndefined();
  });

  it("does not import images when analyze_image returns unstructured text instead of the required JSON", async () => {
    const filesApi = makeFilesApi("https://files.example/research-screenshot.png?sig=123");
    const agentApi = makeAgentApiFromText("The screenshot shows a stock-price chart with a visible downward move and several annotations near the right side.");

    const descriptors = await getResearchFileDownloadDescriptors({
      filesApi,
      agentApi,
      researchQuery: "stock trend",
      attachments: [
        {
          name: "research-screenshot.png",
          path: "research-jobs/r1/uploads/research-screenshot.png",
          content_type: "image/png",
          size_bytes: 1200,
        },
      ],
    });

    expect(descriptors[0].image_analysis).toBeUndefined();
    expect(descriptors[0].image_analysis_error).toContain("Image analysis did not return a JSON object");
  });

  it("does not import images when analyze_image reports URL access failure", async () => {
    const filesApi = makeFilesApi("https://files.example/expired.png?sig=old");
    const agentApi = makeAgentApiFromText("I cannot access the image URL because the download link appears to be expired.");

    const descriptors = await getResearchFileDownloadDescriptors({
      filesApi,
      agentApi,
      researchQuery: "stock trend",
      attachments: [
        {
          name: "expired.png",
          path: "research-jobs/r1/uploads/expired.png",
          content_type: "image/png",
          size_bytes: 1200,
        },
      ],
    });

    expect(descriptors[0].image_analysis).toBeUndefined();
    expect(descriptors[0].image_analysis_error).toContain("Image analysis did not return a JSON object");
  });
});

function makeFilesApi(downloadUrl: string): AnnaFilesApi {
  return {
    async upload_init() {
      throw new Error("not used");
    },
    async upload_finalize() {
      throw new Error("not used");
    },
    async download_url() {
      return { get_url: downloadUrl };
    },
    async list() {
      return { items: [] };
    },
  };
}

function makeAgentApiFromText(text: string): AnnaAgentApi {
  return {
    async session() {
      return {
        async *run() {
          yield { event: "delta", text };
          yield { event: "complete" };
        },
        async delete() {
          return {};
        },
      };
    },
  };
}
