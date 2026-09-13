import type { LlmBatchRequest, LlmProvider, LlmResponseItem } from "../../src/llm/types.js";

type ScriptedResult = LlmResponseItem[] | Error;

export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake";
  readonly model = "fake-model";
  readonly requests: LlmBatchRequest[] = [];

  private readonly script: ScriptedResult[];
  private callIndex = 0;

  constructor(script: ScriptedResult[]) {
    this.script = script;
  }

  async resolveBatch(request: LlmBatchRequest): Promise<LlmResponseItem[]> {
    this.requests.push(request);
    const result = this.script[this.callIndex] ?? this.script[this.script.length - 1];
    this.callIndex += 1;

    if (result instanceof Error) throw result;
    return result;
  }
}
