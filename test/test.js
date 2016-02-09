'use strict';

var raml2obj = require('..');

raml2obj.parse('./example.raml').then(function(ramlObj) {
  console.log('success:');
  console.log(ramlObj);
}, function(error) {
  console.log('error:', error, error.stack);
});

raml2obj.parse('./example-1.0.raml').then(function(ramlObj) {
  console.log('---------------');
  console.log('Test RAML 1.0');
  console.log('---------------');
  console.log('success:');
  console.log(ramlObj);
  console.log(ramlObj.types.TestType);
}, function(error) {
  console.log('---------------');
  console.log('Test RAML 1.0');
  console.log('---------------');
  console.log('error:', error, error.stack);
});
