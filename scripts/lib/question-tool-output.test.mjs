import assert from "node:assert/strict";
import test from "node:test";
import { questionToolRequest, questionToolResult } from "./question-tool-output.mjs";

test("tool diagnostic preserves task/context and uses only a non-executed data function", () => {
  const input = [{ role: "system", content: [{type:"input_text",text:"LEARNBUDDY_STUDENT_EXAM_DRAFT_V1"}] },
    {role:"user",content:[{type:"input_text",text:"Untrusted context"}]}];
  const body = { model:"MiniMax-M3",input,reasoning:{effort:"minimal"},max_output_tokens:8192 };
  const result = questionToolRequest(body);
  assert.equal(input[0].content.length, 1);
  assert.deepEqual(result.input[1], input[1]);
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].parameters.properties.variants.minItems, 4);
  assert.equal(result.tools[0].parameters.properties.variants.items.properties.text.maxLength, 240);
  assert.equal(result.max_output_tokens, 8192);
  assert.deepEqual(result.reasoning, {effort:"minimal"});
  const review = questionToolRequest({...body,input:[{role:"system",content:[{type:"input_text",text:"LEARNORDIE_QUESTION_GROUNDING_REVIEW_V1"}]}]});
  assert.equal(review.tools[0].parameters.properties.reviews.items.properties.answerChecks.minItems, 4);
});

test("tool result is syntax-checked and cannot accept missing, duplicate or different calls", () => {
  const call = {type:"function_call",name:"submit_exam_result",arguments:JSON.stringify({text:'Zitat „stabil"',variants:[]})};
  const result = questionToolResult({status:"completed",output:[call],usage:{output_tokens:50}});
  assert.equal(result.output_text, call.arguments);
  assert.equal(result.usage.output_tokens, 50);
  for (const output of [[],[call,call],[{...call,name:"execute_something"}],[{...call,arguments:'{"broken"'}]]) {
    assert.throws(() => questionToolResult({status:"completed",output}));
  }
  assert.throws(() => questionToolResult({status:"incomplete",output:[call]}));
});

test("auto tool selection may return one complete JSON message without skipping semantic review", () => {
  const text = JSON.stringify({supported:true,variants:[]});
  const message = {type:"message",content:[{type:"output_text",text}]};
  assert.equal(questionToolResult({status:"completed",output:[message]}).output_text, text);
  assert.equal(questionToolResult({status:"completed",output_text:text}).output_text, text);
  // An empty variants array survives transport only; application validation
  // still rejects it. This helper is deliberately not a release quality gate.
  for (const payload of [
    {status:"incomplete",output:[message]},
    {status:"completed",output:[message,message]},
    {status:"completed",output:[{...message,content:[...message.content,...message.content]}]},
    {status:"completed",output_text:'{"variants":'},
    {status:"completed",output_text:'[]'},
    {status:"completed",output_text:'null'},
    {status:"completed",output:[{type:"message",content:[{type:"refusal",refusal:"No"}]}]}
  ]) assert.throws(() => questionToolResult(payload));
});
