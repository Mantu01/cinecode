const directivePattern = /^\s*eslint-(enable|disable)/;

function isDirective(comment) {
  return directivePattern.test(comment.value);
}

const noComments = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow comments; only JSDoc blocks and eslint directives may appear.",
    },
    schema: [],
    messages: {
      unexpected: "Comment is not allowed; names, types and file structure carry the meaning.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isDirective(comment)) continue;
          if (comment.type === "Block" && comment.value.startsWith("*")) continue;
          context.report({ node: comment, messageId: "unexpected" });
        }
      },
    };
  },
};

export const plugin = {
  meta: { name: "@repo/no-comments" },
  rules: { "no-comments": noComments },
};
