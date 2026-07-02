export const moderationTextRules = [
  {
    category: "child_safety_text",
    action: "block",
    patterns: [
      /\bchild\s*(porn|nudes?|sexual|sex|abuse|exploitation)\b/i,
      /\bminor\s*(nudes?|sexual|sex|porn|abuse|exploitation)\b/i,
      /\bunderage\s*(nudes?|sexual|sex|porn)\b/i,
      /\bcsam\b/i,
    ],
  },
  {
    category: "sexual_text",
    action: "review",
    patterns: [
      /\bnudes?\b/i,
      /\bnsfw\b/i,
      /\bporn\b/i,
      /\bexplicit\b/i,
      /\bsexual\b/i,
    ],
  },
  {
    category: "profanity_text",
    action: "review",
    patterns: [
      /\bf+u+c+k+\w*\b/i,
      /\bs+h+i+t+\w*\b/i,
      /\bb+i+t+c+h+\w*\b/i,
      /\ba+s+s+h+o+l+e+s?\b/i,
      /\bc+u+n+t+s?\b/i,
      /\bd+i+c+k+s?\b/i,
      /\bp+u+s+s+y+\w*\b/i,
    ],
  },
];
