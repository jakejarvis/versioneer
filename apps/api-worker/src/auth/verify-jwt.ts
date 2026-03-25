import { createRemoteJWKSet, jwtVerify } from "jose";

import type { AuthUser } from "./types";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, jwks);
  }
  return jwks;
}

export async function verifyCfAccessJwt(
  token: string,
  teamDomain: string,
  expectedAud: string,
): Promise<AuthUser> {
  const jwks = getJwks(teamDomain);

  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://${teamDomain}`,
    audience: expectedAud,
  });

  const email = payload.email;
  if (typeof email !== "string") {
    throw new Error("Missing email claim in JWT");
  }

  return { email, sub: payload.sub ?? email };
}
