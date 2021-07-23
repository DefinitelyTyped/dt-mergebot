import { Context } from "@azure/functions";

export const reply = (context: Context, status: number, body: string) => {
    context.res = { status, body };
    context.log.info(`${body} [${status}]`);
};
