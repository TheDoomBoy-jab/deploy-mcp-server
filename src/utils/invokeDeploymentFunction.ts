import axios from "axios";
import { api } from "../protocol/client.js";

function normalizeArgs(fnMeta: any, rawArgs: Record<string, any> = {}): any {
  if (!fnMeta || !Array.isArray(fnMeta.params) || fnMeta.params.length === 0) {
    return rawArgs;
  }

  const { params } = fnMeta;
  const paramNames = params.map((p: any) => p.name);
  const rawKeys = Object.keys(rawArgs);

  if (params.length === 1 && rawKeys.length > 0 && !paramNames.includes(rawKeys[0])) {
    return [rawArgs];
  }

  const positional = paramNames.map((name: string) => rawArgs[name]);

  const residualKeys = rawKeys.filter((k) => !paramNames.includes(k));
  if (residualKeys.length > 0) {
    const kwargs = Object.fromEntries(residualKeys.map((k) => [k, rawArgs[k]]));
    positional.push(kwargs);
  }

  return positional;
}

export async function invokeDeploymentFunction(
  suffix: string,
  functionName: string,
  type: "call" | "await",
  args?: Record<string, any>
) {
  const deployment = await api.inspectByName(suffix);
  if (!deployment) {
    throw new Error(`Deployment "${suffix}" not found.`);
  }

  const { prefix, version } = deployment;

  const fnMeta = (deployment.packages || [])
    .flatMap((pkg: any) => pkg.functions || [])
    .find((fn: any) => fn.name === functionName);

  const payload = normalizeArgs(fnMeta, args ?? {});

  const url = `https://api.metacall.io/${prefix}/${suffix}/${version}/${type}/${functionName}`;

  try {
    const isGen = Boolean(fnMeta?.isGenerator);
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `jwt ${process.env.METACALL_TOKEN}`
      },
      responseType: isGen ? "stream" : "json"
    });

    let result = response.data;

    if (isGen && typeof response.data?.[Symbol.asyncIterator] === "function") {
      const chunks: any[] = [];
      for await (const chunk of response.data) {
        chunks.push(chunk);
      }
      result = chunks;
    }

    return {
      deployment: suffix,
      function: functionName,
      invocationType: type,
      version,
      result
    };
  } catch (err: any) {
    throw new Error(
      `Failed to invoke "${functionName}" on "${suffix}": ${
        err.response?.status || ""
      } ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`
    );
  }
}