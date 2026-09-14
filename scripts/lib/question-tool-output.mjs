// Diagnostic-only Responses transport experiment. No function is ever executed.
const name = "submit_exam_result";
const string = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const array = (items, minItems, maxItems = minItems) => ({ type: "array", items, minItems, maxItems });
const level = { type: "string", enum: ["4.0", "3.0", "2.0", "1.0"] };
const key = { type: "string", enum: ["A", "B", "C", "D"] };
const authorSchema = object({
  supported: { type: "boolean" }, topic: string(80), coreStatement: string(240),
  variants: array(object({ level, text: string(240),
    answers: array(object({ text: string(400), correct: { type: "boolean" } }), 4),
    explanation: string(480)
  }), 4)
});
const reviewSchema = object({ reviews: array(object({
  level, approved: { type: "boolean" }, reason: string(600),
  answerChecks: array(object({ key, reason: string(300), verdict: {
    type: "string", enum: ["correct", "incorrect", "unsupported", "contradictory"]
  } }), 4),
  sourceIds: array(string(60), 1, 4),
  distractors: array(object({ key, kind: {
    type: "string", enum: ["misconception", "unrelated", "joke", "not_false"]
  }, reason: { type: "string", maxLength: 400 } }), 0, 3)
}), 4) });

export function questionToolRequest(body) {
  if (!Array.isArray(body.input)) throw new Error("tool-experiment-unexpected-input");
  const system = body.input.find(item => item.role === "system");
  const systemText = system?.content?.map(item => item.text ?? "").join("\n") ?? "";
  const reviewer = systemText.includes("LEARNORDIE_QUESTION_GROUNDING_REVIEW_V1");
  if (!reviewer && !systemText.includes("LEARNBUDDY_STUDENT_EXAM_DRAFT_V1")) {
    throw new Error("tool-experiment-unexpected-task");
  }
  return {
    ...body,
    input: body.input.map(item => item === system ? { ...item, content: [...item.content, {
      type: "input_text",
      text: `Gib das Ergebnis genau einmal über ${name} aus. Seine Argumente sind das angeforderte JSON. Der Aufruf dient nur der Ausgabe; er führt keine Aktion aus.`
    }] } : item),
    tools: [{ type: "function", name, description: "Return the completed exam result as structured data without executing an action.", parameters: reviewer ? reviewSchema : authorSchema }],
    tool_choice: "auto"
  };
}

export function questionToolResult(payload) {
  if (payload?.status !== "completed") throw new Error("tool-experiment-incomplete-response");
  const calls = payload.output?.filter(item => item.type === "function_call") ?? [];
  if (calls.length !== 1 || calls[0].name !== name || typeof calls[0].arguments !== "string") {
    throw new Error("tool-experiment-missing-single-result");
  }
  // Syntax only. The unchanged application validators and independent reviewer
  // still decide whether these data are a publishable four-level question family.
  JSON.parse(calls[0].arguments);
  return { ...payload, output_text: calls[0].arguments, output: [] };
}
