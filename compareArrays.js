/**
 * Checks if array1 contains all elements from array2 by their id property, ignoring order
 * @param {Array} array1 - Array that should contain all elements from array2
 * @param {Array} array2 - Array whose elements should be contained in array1
 * @returns {boolean} True if array1 contains all elements from array2 (by id), false otherwise
 */
function compareArraysById(array1, array2) {
  if (!Array.isArray(array1) || !Array.isArray(array2)) {
    throw new Error('Both parameters must be arrays');
  }

  // If array2 is empty, it's always contained in array1
  if (array2.length === 0) {
    return true;
  }

  // If array1 is empty but array2 is not, array1 doesn't contain array2
  if (array1.length === 0) {
    return false;
  }

  // Extract IDs from both arrays and create sets for comparison
  const ids1 = new Set(array1.map(item => item.id));
  const ids2 = new Set(array2.map(item => item.id));

  // Check if all IDs in array2 exist in array1
  for (const id of ids2) {
    if (!ids1.has(id)) {
      return false;
    }
  }

  return true;
}

// Example usage:
const array1 = [
  { id: 1, name: 'Item A' },
  { id: 2, name: 'Item B' },
  { id: 3, name: 'Item C' },
  { id: 4, name: 'Item D' }
];

const array2 = [
  { id: 2, name: 'Item B' },
  { id: 4, name: 'Item D' }
];

const array3 = [
  { id: 1, name: 'Item A' },
  { id: 5, name: 'Item E' }
];

console.log('array1 contains array2:', compareArraysById(array1, array2)); // true (array1 contains all IDs from array2)
console.log('array1 contains array3:', compareArraysById(array1, array3)); // false (array1 doesn't contain ID 5)
console.log('Empty array2:', compareArraysById(array1, [])); // true (empty array is always contained)
console.log('Empty array1:', compareArraysById([], array2)); // false (empty array can't contain non-empty array)

// Export for use in other modules
module.exports = compareArraysById;
