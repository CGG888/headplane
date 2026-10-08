import { describe, expect, test } from "vitest";

import { assetProbeOrigins, selfOrigin } from "~/server/self-origin";

describe("self origin", () => {
  test("falls back to the loopback address for a wildcard bind", () => {
    expect(selfOrigin({ host: "0.0.0.0", port: 3000 })).toBe("http://127.0.0.1:3000");
    expect(selfOrigin({ host: "::", port: 3000 })).toBe("http://127.0.0.1:3000");
    expect(selfOrigin({ host: "[::]", port: 3000 })).toBe("http://127.0.0.1:3000");
  });

  test("keeps the address the listener is bound to", () => {
    expect(selfOrigin({ host: "192.168.88.101", port: 4100 })).toBe("http://192.168.88.101:4100");
  });

  test("brackets an IPv6 bind address", () => {
    expect(selfOrigin({ host: "fd00::1", port: 4100 })).toBe("http://[fd00::1]:4100");
  });

  test("uses https when TLS material is configured", () => {
    expect(selfOrigin({ host: "0.0.0.0", port: 4100, tls_cert_path: "/c.pem" })).toBe(
      "https://127.0.0.1:4100",
    );
    expect(
      selfOrigin({ host: "0.0.0.0", port: 4100, tls_cert_path: "", tls_key_path: "/k.pem" }),
    ).toBe("https://127.0.0.1:4100");
  });
});

describe("asset probe origins", () => {
  test("probes the listener before the origin the request reported", () => {
    expect(
      assetProbeOrigins({ host: "192.168.88.101", port: 4100 }, "http://et.example.com:8443"),
    ).toEqual(["http://192.168.88.101:4100", "http://et.example.com:8443"]);
  });

  test("does not probe the same origin twice", () => {
    expect(assetProbeOrigins({ host: "0.0.0.0", port: 4100 }, "http://127.0.0.1:4100")).toEqual([
      "http://127.0.0.1:4100",
    ]);
  });
});
