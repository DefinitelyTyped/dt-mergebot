export function formatMutationRequest(mutationRequestString: string) {
  try {
    const body = JSON.parse(mutationRequestString);
    if (body.variables?.input?.body?.length > 140) {
      body.variables.input.body = body.variables.input.body.slice(0, 100)
        + ' ... '
        + body.variables.input.body.slice(body.variables.input.body.length - 40);
    }
    return JSON.stringify(body, undefined, 2);
  } catch {
    return mutationRequestString;
  }
}