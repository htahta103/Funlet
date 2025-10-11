/**
 * Improved onChange function with error handling and validation
 */
function onChange() {
  try {
    // Check if context and component exist
    if (!context?.component?.variables) {
      console.warn('Context or component variables not available');
      return;
    }

    const variables = context.component.variables;
    
    // Define the variable mappings
    const variableMappings = [
      {
        source: '92e2c884-373c-410e-8dbc-673e6226dc1e-faa28601-8c78-4d67-8242-95ff917d0bf4',
        target: 'cdbc6ab0-8fdc-4344-8a48-3dc655b6c288',
        name: 'selected_products'
      },
      {
        source: '92e2c884-373c-410e-8dbc-673e6226dc1e-8760ff94-e4e9-4427-80cc-4055d5397111',
        target: '4fc20c71-599e-43fc-8294-b1080f25eea9',
        name: 'selected_variants'
      }
    ];

    // Process each mapping
    variableMappings.forEach(({ source, target, name }) => {
      const sourceValue = variables[source];
      
      if (sourceValue !== undefined) {
        // Create a deep copy to avoid reference issues
        variables[target] = JSON.parse(JSON.stringify(sourceValue));
        console.log(`Updated ${name}:`, variables[target]);
      } else {
        console.warn(`Source variable for ${name} not found:`, source);
        // Set to empty array as fallback
        variables[target] = [];
      }
    });

  } catch (error) {
    console.error('Error in onChange function:', error);
    // Optionally, you might want to set default values
    if (context?.component?.variables) {
      context.component.variables['cdbc6ab0-8fdc-4344-8a48-3dc655b6c288'] = [];
      context.component.variables['4fc20c71-599e-43fc-8294-b1080f25eea9'] = [];
    }
  }
}

/**
 * Alternative version with more defensive programming
 */
function onChangeDefensive() {
  // Early return if context is not available
  if (!context) {
    console.warn('Context not available');
    return;
  }

  if (!context.component) {
    console.warn('Component not available');
    return;
  }

  if (!context.component.variables) {
    console.warn('Component variables not available');
    return;
  }

  const variables = context.component.variables;
  
  // Safe assignment with fallbacks
  const selectedProducts = variables['92e2c884-373c-410e-8dbc-673e6226dc1e-faa28601-8c78-4d67-8242-95ff917d0bf4'];
  const selectedVariants = variables['92e2c884-373c-410e-8dbc-673e6226dc1e-8760ff94-e4e9-4427-80cc-4055d5397111'];

  // Assign with validation
  variables['cdbc6ab0-8fdc-4344-8a48-3dc655b6c288'] = Array.isArray(selectedProducts) ? [...selectedProducts] : [];
  variables['4fc20c71-599e-43fc-8294-b1080f25eea9'] = Array.isArray(selectedVariants) ? [...selectedVariants] : [];
}

/**
 * Version with logging for debugging
 */
function onChangeWithLogging() {
  console.log('onChange called');
  
  if (!context?.component?.variables) {
    console.error('Context or variables not available');
    return;
  }

  const variables = context.component.variables;
  
  // Log current values before update
  console.log('Before update:');
  console.log('selected_products:', variables['cdbc6ab0-8fdc-4344-8a48-3dc655b6c288']);
  console.log('selected_variants:', variables['4fc20c71-599e-43fc-8294-b1080f25eea9']);
  
  // Perform the updates
  variables['cdbc6ab0-8fdc-4344-8a48-3dc655b6c288'] = variables['92e2c884-373c-410e-8dbc-673e6226dc1e-faa28601-8c78-4d67-8242-95ff917d0bf4'];
  variables['4fc20c71-599e-43fc-8294-b1080f25eea9'] = variables['92e2c884-373c-410e-8dbc-673e6226dc1e-8760ff94-e4e9-4427-80cc-4055d5397111'];
  
  // Log values after update
  console.log('After update:');
  console.log('selected_products:', variables['cdbc6ab0-8fdc-4344-8a48-3dc655b6c288']);
  console.log('selected_variants:', variables['4fc20c71-599e-43fc-8294-b1080f25eea9']);
}

/**
 * Version using context.component.methods.updateVariable
 */
function onChangeWithMethods() {
  try {
    // Get source values
    const sourceProducts = context?.component?.variables?.['92e2c884-373c-410e-8dbc-673e6226dc1e-faa28601-8c78-4d67-8242-95ff917d0bf4'];
    const sourceVariants = context?.component?.variables?.['92e2c884-373c-410e-8dbc-673e6226dc1e-8760ff94-e4e9-4427-80cc-4055d5397111'];
    
    // Update using context.component.methods.updateVariable
    context.component.methods.updateVariable('cdbc6ab0-8fdc-4344-8a48-3dc655b6c288', sourceProducts || []);
    context.component.methods.updateVariable('4fc20c71-599e-43fc-8294-b1080f25eea9', sourceVariants || []);
    
    console.log('Variables updated successfully via methods.updateVariable');
  } catch (error) {
    console.error('Error updating variables:', error);
  }
}

// Export the functions
module.exports = {
  onChange,
  onChangeDefensive,
  onChangeWithLogging,
  onChangeWithMethods
};
