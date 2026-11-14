const noMathRandom = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow bare Math.random() so renders stay deterministic; use the seeded random API instead.",
    },
    schema: [],
    messages: {
      unexpected:
        "Math.random() breaks deterministic rendering. Use random(seed) or a SeedManager subseed from cinecode instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.computed) return;
        if (callee.object.type !== "Identifier" || callee.object.name !== "Math") return;
        if (callee.property.type !== "Identifier" || callee.property.name !== "random") return;
        context.report({ node, messageId: "unexpected" });
      },
    };
  },
};

export const plugin = {
  meta: { name: "@repo/no-math-random" },
  rules: { "no-math-random": noMathRandom },
};
