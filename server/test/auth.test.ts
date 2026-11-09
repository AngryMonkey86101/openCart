import { describe, expect, it } from "vitest";
import { signInitData, validateInitData } from "../src/auth.js";

const TOKEN = "123456:TEST-TOKEN";
const user = JSON.stringify({ id: 42, first_name: "Аня", username: "anya" });

describe("validateInitData", () => {
  it("принимает корректно подписанные данные", async () => {
    const authDate = String(Math.floor(Date.now() / 1000));
    const raw = await signInitData({ user, auth_date: authDate, start_param: "abc" }, TOKEN);
    const data = await validateInitData(raw, TOKEN);
    expect(data?.user.id).toBe(42);
    expect(data?.startParam).toBe("abc");
  });

  it("отклоняет подделанные данные", async () => {
    const authDate = String(Math.floor(Date.now() / 1000));
    const raw = await signInitData({ user, auth_date: authDate }, TOKEN);
    const tampered = raw.replace("42", "43");
    expect(await validateInitData(tampered, TOKEN)).toBeNull();
  });

  it("отклоняет данные, подписанные другим токеном", async () => {
    const authDate = String(Math.floor(Date.now() / 1000));
    const raw = await signInitData({ user, auth_date: authDate }, "other:token");
    expect(await validateInitData(raw, TOKEN)).toBeNull();
  });

  it("отклоняет устаревшие данные", async () => {
    const authDate = String(Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60);
    const raw = await signInitData({ user, auth_date: authDate }, TOKEN);
    expect(await validateInitData(raw, TOKEN)).toBeNull();
  });
});
