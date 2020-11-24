import { Comment } from "../comments";

export const prefix = "\n<!--typescript_bot_";
export const suffix = "-->";

export function parse(body: string): Comment | undefined {
  const start = body.lastIndexOf(prefix);
  const end = body.lastIndexOf(suffix);
  return start < 0 || end < 0 || end + suffix.length != body.length
    ? undefined
    : { status: body.substr(0, start),
        tag: body.substr(start + prefix.length, end - start - prefix.length),
      };
}

export function make(body: string, tag: string) {
  return `${body}${prefix}${tag}${suffix}`;
}
