import { generateKeyPairSync, sign } from "node:crypto";

/** Ephemeral self-signed TLS fixture, never trusted outside ignoreHTTPSErrors test contexts. */
export function httpsFixture() {
  const der = (tag, ...items) => {
    const body = Buffer.concat(items);
    let length = body.length;
    const bytes = [];
    while (length) { bytes.unshift(length & 255); length >>>= 8; }
    const prefix = body.length < 128 ? [body.length] : [0x80 | bytes.length, ...bytes];
    return Buffer.concat([Buffer.from([tag, ...prefix]), body]);
  };
  const sequence = (...items) => der(0x30, ...items);
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const algorithm = sequence(Buffer.from("06092a864886f70d01010b0500", "hex")); // sha256WithRSAEncryption
  const name = sequence(der(0x31, sequence(Buffer.from("0603550403", "hex"), der(0x0c, Buffer.from("localhost")))));
  const date = value => der(0x18, Buffer.from(value.toISOString().replace(/[-:T]/g, "").replace(/\.\d+Z$/, "Z")));
  const tbs = sequence(der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, Buffer.from([1])), algorithm,
    name, sequence(date(new Date(Date.now() - 60_000)), date(new Date(Date.now() + 86_400_000))), name,
    publicKey.export({ format: "der", type: "spki" }));
  const certDer = sequence(tbs, algorithm, der(0x03, Buffer.from([0]), sign("sha256", tbs, privateKey)));
  return { key: privateKey.export({ format: "pem", type: "pkcs8" }),
    cert: `-----BEGIN CERTIFICATE-----\n${certDer.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n` };
}
