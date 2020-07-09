import { client } from "../graphql-client";
import { GetFileContent } from "../queries/file-query";
import { GetFileContent as GetFileContentResult } from "../queries/schema/GetFileContent";

export async function fetchFile(expr: string, limit?: number): Promise<string | undefined> {
  const info = await client.query<GetFileContentResult>({
      query: GetFileContent,
      variables: {
          name: "DefinitelyTyped",
          owner: "DefinitelyTyped",
          expr: `${expr}`
      }
  });
  const text = info.data.repository?.object?.__typename !== "Blob" ? undefined
        : info.data.repository.object.text;
  if (text && limit && text.length > limit) {
    return text.substring(0, limit);
  } else {
    return text ?? undefined;
  }
}
