/**
 * Filters variant objects based on the is_add parameter
 * @param {Array} selected_variants - Array of objects with id property
 * @param {Array} variants - Array of objects with id property to add/remove
 * @param {boolean} is_add - If true, adds all variants to selected_variants (unique)
 *                          If false, removes all variants from selected_variants by id
 * @returns {Array} Updated array of variant objects
 */
function filterVariants(selected_variants, variants, is_add) {
  if (!Array.isArray(selected_variants) || !Array.isArray(variants)) {
    throw new Error('selected_variants and variants must be arrays');
  }

  if (is_add) {
    // Add all variants to selected_variants, ensuring uniqueness
    const existingIds = new Set(selected_variants.map(item => item.id));
    const newVariants = variants.filter(item => !existingIds.has(item.id));
    return [...selected_variants, ...newVariants];
  } else {
    // Remove all variants from selected_variants by id
    const variantIdsToRemove = new Set(variants.map(item => item.id));
    return selected_variants.filter(item => !variantIdsToRemove.has(item.id));
  }
}

// Example usage:
const selected = [
  { id: 1, name: 'Variant A' },
  { id: 2, name: 'Variant B' },
  { id: 3, name: 'Variant C' }
];

const variants = [
  { id: 2, name: 'Variant B' },
  { id: 4, name: 'Variant D' },
  { id: 6, name: 'Variant F' }
];

console.log('is_add = true:', filterVariants(selected, variants, true));  // Adds variants 4 and 6, keeps existing 1,2,3
console.log('is_add = false:', filterVariants(selected, variants, false)); // Removes variant 2, keeps 1 and 3

// Export for use in other modules
module.exports = filterVariants;
