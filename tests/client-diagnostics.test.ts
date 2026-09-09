import { afterEach, expect, it, vi } from "vitest";
import { clientDiagnostic } from "../app/journey-diagnostics";

afterEach(() => vi.unstubAllGlobals());
it("client diagnostics validate fixed fields and remain fire-and-forget when the network fails", async () => {
  const fetchMock=vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch',fetchMock);
  const traceId=crypto.randomUUID();
  expect(() => clientDiagnostic('upload_failed',traceId,{stage:'transfer',outcome:'failed',durationMs:123})).not.toThrow();
  await Promise.resolve();
  const body=JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body).toEqual({event:'upload_failed',traceId,details:{stage:'transfer',outcome:'failed',durationMs:123,version:'0.33'}});
  expect(fetchMock.mock.calls[0][1]).toMatchObject({credentials:'same-origin',keepalive:true});
  clientDiagnostic('upload_failed','bad-id',{stage:'transfer',outcome:'failed',durationMs:123});
  expect(fetchMock).toHaveBeenCalledOnce();
});
