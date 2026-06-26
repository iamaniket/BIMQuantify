// Quick test to show the behavior
import { twMerge, extendTailwindMerge } from 'tailwind-merge';

// Without extending - text-body2 would be classified as color (not registered as font-size)
const result1 = twMerge('bg-primary text-primary-foreground text-body2');
console.log('Without custom fontSize:', result1);

// With extending - text-body2 is properly classified as font-size
const customSizes = ['micro', 'caption', 'body3', 'body2', 'body1', 'title3', 'title2', 'title1', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const extendedMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: customSizes,
        },
      ],
    },
  },
});

const result2 = extendedMerge('bg-primary text-primary-foreground text-body2');
console.log('With custom fontSize:', result2);

// The real issue scenario: adding text-body2 first, then text-primary-foreground
const result3 = twMerge('text-body2 text-primary-foreground');
console.log('Scenario 1 (without extension):', result3);

const result4 = extendedMerge('text-body2 text-primary-foreground');
console.log('Scenario 2 (with extension):', result4);
