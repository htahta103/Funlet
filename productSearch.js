/**
 * Searches through a list of product objects with nested SKUs
 * @param {Array} products - Array of product objects with skus property
 * @param {string} searchTerm - Search term to match against
 * @param {Object} options - Search options
 * @param {Array} options.searchFields - Fields to search in (default: ['name', 'brand', 'price', 'category', 'product_code'])
 * @param {Array} options.skuFields - SKU fields to search in (default: ['name', 'sku_code'])
 * @param {boolean} options.caseSensitive - Whether search is case sensitive (default: false)
 * @param {boolean} options.exactMatch - Whether to require exact match (default: false)
 * @returns {Array} Filtered array of products with matching SKUs only
 */
function searchProducts(products, searchTerm, options = {}) {
  if (!Array.isArray(products)) {
    return [];
  }
  
  // If searchTerm is empty, return all products
  if (!searchTerm || searchTerm.trim() === '') {
    return products;
  }

  const {
    searchFields = ['name', 'brand', 'price', 'category', 'product_code'],
    skuFields = ['name', 'sku_code'],
    caseSensitive = false,
    exactMatch = false
  } = options;

  const normalizedSearchTerm = caseSensitive ? searchTerm : searchTerm.toLowerCase();

  return products
    .map(product => {
      // Check if product-level fields match
      const productMatches = searchFields.some(field => {
        const value = product[field];
        if (value === null || value === undefined) return false;
        
        const normalizedValue = caseSensitive ? String(value) : String(value).toLowerCase();
        
        if (exactMatch) {
          return normalizedValue === normalizedSearchTerm;
        } else {
          return normalizedValue.includes(normalizedSearchTerm);
        }
      });

      // Check if any SKU matches
      const matchingSkus = (product.skus || []).filter(sku => {
        return skuFields.some(field => {
          const value = sku[field];
          if (value === null || value === undefined) return false;
          
          const normalizedValue = caseSensitive ? String(value) : String(value).toLowerCase();
          
          if (exactMatch) {
            return normalizedValue === normalizedSearchTerm;
          } else {
            return normalizedValue.includes(normalizedSearchTerm);
          }
        });
      });

      // If product matches, return the full product
      if (productMatches) {
        return product;
      }
      
      // If SKUs match, return product with only matching SKUs
      if (matchingSkus.length > 0) {
        return {
          ...product,
          skus: matchingSkus
        };
      }

      return null;
    })
    .filter(product => product !== null);
}

/**
 * Advanced search with multiple criteria
 * @param {Array} products - Array of product objects
 * @param {Object} criteria - Search criteria
 * @param {string} criteria.name - Product name to search
 * @param {string} criteria.brand - Brand to search
 * @param {number} criteria.minPrice - Minimum price
 * @param {number} criteria.maxPrice - Maximum price
 * @param {string} criteria.category - Category to search
 * @param {string} criteria.skuName - SKU name to search
 * @param {string} criteria.skuCode - SKU code to search
 * @returns {Array} Filtered products
 */
function advancedProductSearch(products, criteria) {
  if (!Array.isArray(products) || !criteria) {
    return [];
  }

  return products
    .map(product => {
      let productMatches = true;
      let matchingSkus = product.skus || [];

      // Check product-level criteria
      if (criteria.name && !product.name?.toLowerCase().includes(criteria.name.toLowerCase())) {
        productMatches = false;
      }
      
      if (criteria.brand && !product.brand?.toLowerCase().includes(criteria.brand.toLowerCase())) {
        productMatches = false;
      }
      
      if (criteria.category && !product.category?.toLowerCase().includes(criteria.category.toLowerCase())) {
        productMatches = false;
      }
      
      if (criteria.minPrice !== undefined && product.price < criteria.minPrice) {
        productMatches = false;
      }
      
      if (criteria.maxPrice !== undefined && product.price > criteria.maxPrice) {
        productMatches = false;
      }

      // Check SKU-level criteria
      if (criteria.skuName || criteria.skuCode) {
        matchingSkus = matchingSkus.filter(sku => {
          let skuMatches = true;
          
          if (criteria.skuName && !sku.name?.toLowerCase().includes(criteria.skuName.toLowerCase())) {
            skuMatches = false;
          }
          
          if (criteria.skuCode && !sku.sku_code?.toLowerCase().includes(criteria.skuCode.toLowerCase())) {
            skuMatches = false;
          }
          
          return skuMatches;
        });
      }

      // Return product if it matches or has matching SKUs
      if (productMatches) {
        return product;
      } else if (matchingSkus.length > 0) {
        return {
          ...product,
          skus: matchingSkus
        };
      }

      return null;
    })
    .filter(product => product !== null);
}

/**
 * Search with highlighting of matching terms
 * @param {Array} products - Array of product objects
 * @param {string} searchTerm - Search term
 * @returns {Array} Products with highlighted matches
 */
function searchWithHighlighting(products, searchTerm) {
  const results = searchProducts(products, searchTerm);
  
  const highlight = (text, term) => {
    if (!text || !term) return text;
    const regex = new RegExp(`(${term})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  };

  return results.map(product => ({
    ...product,
    name: highlight(product.name, searchTerm),
    brand: highlight(product.brand, searchTerm),
    category: highlight(product.category, searchTerm),
    product_code: highlight(product.product_code, searchTerm),
    skus: product.skus?.map(sku => ({
      ...sku,
      name: highlight(sku.name, searchTerm),
      sku_code: highlight(sku.sku_code, searchTerm)
    }))
  }));
}

// Example usage and test data
const sampleProducts = [
  {
    id: "ff02cafc-13f3-40cb-8772-fc851f556696",
    name: "Classic Cotton T-Shirt",
    brand: "Nike",
    price: 299,
    category: "Apparel",
    product_code: "PROD-TSH-001",
    skus: [
      {
        id: "37158166-383d-4456-8cf0-e367e5d69d5e",
        name: "Classic Cotton T-Shirt – Small",
        price: 299,
        sku_code: "SKU-TSH-001-S"
      },
      {
        id: "47258166-383d-4456-8cf0-e367e5d69d5e",
        name: "Classic Cotton T-Shirt – Medium",
        price: 299,
        sku_code: "SKU-TSH-001-M"
      },
      {
        id: "57358166-383d-4456-8cf0-e367e5d69d5e",
        name: "Classic Cotton T-Shirt – Large",
        price: 299,
        sku_code: "SKU-TSH-001-L"
      }
    ]
  },
  {
    id: "aa02cafc-13f3-40cb-8772-fc851f556696",
    name: "Running Shoes",
    brand: "Adidas",
    price: 599,
    category: "Footwear",
    product_code: "PROD-SHO-001",
    skus: [
      {
        id: "67458166-383d-4456-8cf0-e367e5d69d5e",
        name: "Running Shoes – Size 8",
        price: 599,
        sku_code: "SKU-SHO-001-8"
      },
      {
        id: "77558166-383d-4456-8cf0-e367e5d69d5e",
        name: "Running Shoes – Size 9",
        price: 599,
        sku_code: "SKU-SHO-001-9"
      }
    ]
  }
];

// Test the search function
console.log('Search for "small":');
console.log(JSON.stringify(searchProducts(sampleProducts, 'small'), null, 2));

console.log('\nSearch for "nike":');
console.log(JSON.stringify(searchProducts(sampleProducts, 'nike'), null, 2));

console.log('\nAdvanced search for products under 400:');
console.log(JSON.stringify(advancedProductSearch(sampleProducts, { maxPrice: 400 }), null, 2));

console.log('\nSearch with highlighting:');
console.log(JSON.stringify(searchWithHighlighting(sampleProducts, 'small'), null, 2));

// Export functions
module.exports = {
  searchProducts,
  advancedProductSearch,
  searchWithHighlighting
};
