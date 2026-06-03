import { describe, it, expect } from "vitest";
import { shouldCapture } from "../src/capture.js";

describe("shouldCapture", () => {
  const base = { chatAllow: [] as string[], chatDeny: [] as string[], skipPatterns: [] as string[] };
  it("預設全收", () => {
    expect(shouldCapture("1", "任意內容", base)).toBe(true);
  });
  it("chatDeny 命中則不收", () => {
    expect(shouldCapture("1", "x", { ...base, chatDeny: ["1"] })).toBe(false);
  });
  it("chatAllow 非空且不含則不收", () => {
    expect(shouldCapture("2", "x", { ...base, chatAllow: ["1"] })).toBe(false);
    expect(shouldCapture("1", "x", { ...base, chatAllow: ["1"] })).toBe(true);
  });
  it("skipPatterns 命中則不收", () => {
    expect(shouldCapture("1", "福利通 v8 進度報告", { ...base, skipPatterns: ["^福利通 v\\d+ 進度報告"] })).toBe(false);
  });
  it("壞 regex 不炸、視為不過濾", () => {
    expect(shouldCapture("1", "x", { ...base, skipPatterns: ["(unclosed"] })).toBe(true);
  });
});
