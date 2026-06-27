// Test the trigger scenario: adding text-body0 to tailwind-config but forgetting cn.ts
import { twMerge, extendTailwindMerge } from 'tailwind-merge';

// Current registered sizes (from cn.ts)
const currentSizes = ['micro', 'caption', 'body3', 'body2', 'body1', 'title3', 'title2', 'title1', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

// Hypothetical future sizes (someone adds body0 to tailwind-config but forgets cn.ts)
const futureSizes = ['micro', 'caption', 'body0', 'body3', 'body2', 'body1', 'title3', 'title2', 'title1', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

const currentExtendedMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: currentSizes }],
    },
  },
});

const futureExtendedMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: futureSizes }],
    },
  },
});

// Test case: using primary button with the new body0 size
const testClasses = 'bg-primary text-primary-foreground text-body0';

console.log('Current (body0 NOT in cn.ts):', currentExtendedMerge(testClasses));
console.log('Future (body0 in cn.ts):', futureExtendedMerge(testClasses));
console.log('');
console.log('Explanation:');
console.log('  If body0 is added to tailwind-config but cn.ts is not updated:');
console.log('  - text-body0 gets misclassified as a text-COLOR');
console.log('  - text-primary-foreground gets silently DROPPED');
console.log('  - No error at build/runtime - just broken UI!');
