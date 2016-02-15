#!/usr/bin/env node

'use strict';

var raml = require('raml-1-parser');
var fs = require('fs');
var Q = require('q');

function _parseBaseUri(ramlObj) {
    // I have no clue what kind of variables the RAML spec allows in the baseUri.
    // For now keep it super super simple.
    if (ramlObj.baseUri) {
        ramlObj.baseUri = ramlObj.baseUri.replace('{version}', ramlObj.version);
    }

    return ramlObj;
}

function _ltrim(str, chr) {
    var rgxtrim = (!chr) ? new RegExp('^\\s+') : new RegExp('^' + chr + '+');
    return str.replace(rgxtrim, '');
}

function _makeUniqueId(resource) {
    var fullUrl = resource.parentUrl + resource.relativeUri;
    return _ltrim(fullUrl.replace(/\W/g, '_'), '_');
}

function _traverse(ramlObj, parentUrl, allUriParameters) {
    // Add unique id's and parent URL's plus parent URI parameters to resources
    for (var index in ramlObj.resources) {
        if (ramlObj.resources.hasOwnProperty(index)) {
            var resource = ramlObj.resources[index];
            resource.parentUrl = parentUrl || '';
            resource.uniqueId = _makeUniqueId(resource);
            resource.allUriParameters = [];

            if (allUriParameters) {
                resource.allUriParameters.push.apply(resource.allUriParameters, allUriParameters);
            }

            if (resource.uriParameters) {
                for (var key in resource.uriParameters) {
                    if (resource.uriParameters.hasOwnProperty(key)) {
                        resource.allUriParameters.push(resource.uriParameters[key]);
                    }
                }
            }

            if (resource.methods) {
                for (var methodkey in resource.methods) {
                    if (resource.methods.hasOwnProperty(methodkey)) {
                        resource.methods[methodkey].allUriParameters = resource.allUriParameters;
                    }
                }
            }

            _traverse(resource, resource.parentUrl + resource.relativeUri, resource.allUriParameters);
        }
    }

    return ramlObj;
}

function _addUniqueIdsToDocs(ramlObj) {
    // Add unique id's to top level documentation chapters
    for (var idx in ramlObj.documentation) {
        if (ramlObj.documentation.hasOwnProperty(idx)) {
            var docSection = ramlObj.documentation[idx];
            docSection.uniqueId = docSection.title.replace(/\W/g, '-');
        }
    }

    return ramlObj;
}

function _enhanceRamlObj(ramlObj) {
    ramlObj = _parseBaseUri(ramlObj);
    ramlObj = _traverse(ramlObj);
    return _addUniqueIdsToDocs(ramlObj);
}

function _sourceToRamlObj(source) {
    if (typeof source === 'string') {
        if (fs.existsSync(source) || source.indexOf('http') === 0) {
            // Parse as file or url
            return raml.loadApi(source);
        }

        // Parse as string or buffer
        return raml.load('' + source);
    } else if (source instanceof Buffer) {
        // Parse as buffer
        return raml.load('' + source);
    } else if (typeof source === 'object') {
        // Parse RAML object directly
        return Q.fcall(function () {
            return source;
        });
    }

    return Q.fcall(function () {
        throw new Error('_sourceToRamlObj: You must supply either file, url, data or obj as source.');
    });
}

function parse(source) {
    return _sourceToRamlObj(source).then(function (api) {
        api.errors().forEach(function (x) {
            if (x.isWarning || x.code === 10) {
                return;
            }

            console.log('Error in parsing: ', JSON.stringify({
                code:      x.code,
                message:   x.message,
                path:      x.path,
                line:      x.line,
                column:    x.column,
                isWarning: x.isWarning
            }, null, 2));
        });

        //console.log('!');
        //console.log(api._node._children["0"]._node._node.value.mappings["1"].value.mappings["1"]);
        //console.log(api._node._children["0"]._node._node.value.mappings["1"].value.mappings["1"]);

        var json = api.toJSON();

        //api.allResources().forEach(function(resource) {
        //    console.log(resource.absoluteUri());
        //
        //    resource.methods().forEach(function(method) {
        //        console.log('    ', method.method());
        //
        //        method.responses().forEach(function(response) {
        //            console.log('        ', response.code().value());
        //        });
        //    });
        //});

        //var util = require('util');
        //console.log();
        //console.log();

        var processProps = function(obj, prop) {
            var propName = prop.name();

            if (prop.optional()) {
                var pr = obj.properties[propName];

                if (typeof pr !== 'object') {
                    obj.properties[propName] = {
                        type: pr
                    };
                }

                obj.properties[propName].isOptional = true;
            }

            if (prop.properties) {
                prop.properties().forEach(function(pr) {
                    obj.properties[propName] = processProps(obj.properties[propName], pr);
                });
            }

            return obj;
        };
        var processTypes = function(obj, type) {
            if (type.optional()) {
                if (typeof obj !== 'object') {
                    obj = {
                        type: obj
                    };
                }

                obj.isOptional = true;
            }

            return obj;
        };

        // types
        api.types().forEach(function (type) {
            var typeName = type.name();
            if (type.properties) {
                type.properties().forEach(function (prop) {
                    json.types[typeName] = processProps(json.types[typeName], prop);
                });
            }
        });

        // resource types
        api.resourceTypes().forEach(function(rt) {
            var rtName = rt.name();
            rt.methods().forEach(function(m) {
                var mName = m.method();
                m.responses().forEach(function(r) {
                    var rName = r.code().value();
                    r.body().forEach(function(b) {
                        var bName = b.name();
                        b.properties().forEach(function(p) {
                            json.resourceTypes[rtName][mName].responses[rName].body[bName] = processProps(json.resourceTypes[rtName][mName].responses[rName].body[bName], p);
                        });
                    });
                });
                m.body().forEach(function(b) {
                    var bName = b.name();
                    b.properties().forEach(function(p) {
                        json.resourceTypes[rtName][mName].body[bName] = processProps(json.resourceTypes[rtName][mName].body[bName], p);
                    });
                });
                m.queryParameters().forEach(function(qp) {
                    var qpName = qp.name();
                    json.resourceTypes[rtName][mName].queryParameters[qpName] = processTypes(json.resourceTypes[rtName][mName].queryParameters[qpName], qp);
                });
            });
        });

        var resourceRecursion = function(obj, res) {
            if (res.parentResource()) {
                obj = resourceRecursion(obj, res.parentResource());
            }

            return obj[res.relativeUri().value()];
        };

        //resources
        api.allResources().forEach(function(r) {
            var obj = resourceRecursion(json, r);
            r.methods().forEach(function(m) {
                var mName = m.method();
                m.responses().forEach(function(res) {
                    var resName = res.code().value();
                    res.body().forEach(function(b) {
                        var bName = b.name();
                        b.properties().forEach(function(p) {
                            obj[mName].responses[resName].body[bName] = processProps(obj[mName].responses[resName].body[bName], p);
                        });
                    });
                });
                m.body().forEach(function(b) {
                    var bName = b.name();
                    b.properties().forEach(function(p) {
                        obj[mName].body[bName] = processProps(obj[mName].body[bName], p);
                    });
                });
                m.queryParameters().forEach(function(qp) {
                    var qpName = qp.name();
                    obj[mName].queryParameters[qpName] = processTypes(obj[mName].queryParameters[qpName], qp);
                });
            });

            //r.allUriParameters().forEach(function(up) {
            //    var upName = up.name();
            //
            //    console.log('up', upName);
            //
            //    obj[upName] = processProps(obj[upName], up);
            //});
        });

        // security schemes
        api.securitySchemes().forEach(function(ss) {
            var ssName = ss.name();
            ss.describedBy().body().forEach(function(b) {
                var bName = b.name();
                b.properties().forEach(function(p) {
                    json.securitySchemes[ssName].describedBy.body[bName] = processProps(json.securitySchemes[ssName].describedBy.body[bName], p);
                });
            });
            ss.describedBy().responses().forEach(function(r) {
                var rName = r.code().value();
                r.body().forEach(function(b) {
                    var bName = b.name();
                    b.properties().forEach(function(p) {
                        json.securitySchemes[ssName].describedBy.responses[rName].body[bName] = processProps(json.securitySchemes[ssName].describedBy.responses[rName].body[bName], p);
                    });
                });
            });
            ss.describedBy().queryParameters().forEach(function(qp) {
                var qpName = qp.name();
                json.securitySchemes[ssName].describedBy.queryParameters[qpName] = processTypes(json.securitySchemes[ssName].describedBy.queryParameters[qpName], qp);
            });
        });

        // traits
        api.allTraits().forEach(function(t) {
            var tName = t.name();
            t.body().forEach(function(b) {
                var bName = b.name();
                b.properties().forEach(function(p) {
                    json.traits[tName].body[bName] = processProps(json.traits[tName].body[bName], p);
                });
            });
            t.responses().forEach(function(r) {
                var rName = r.code().value();
                r.body().forEach(function(b) {
                    var bName = b.name();
                    b.properties().forEach(function(p) {
                        json.traits[tName].responses[rName].body[bName] = processProps(json.traits[tName].responses[rName].body[bName], p);
                    });
                });
            });
            t.queryParameters().forEach(function(qp) {
                var qpName = qp.name();
                json.traits[tName].queryParameters[qpName] = processTypes(json.traits[tName].queryParameters[qpName], qp);
            });
        });

        //console.log();
        //console.log();
        //console.log(util.inspect(json, {showHidden: false, depth: null}));

        return _enhanceRamlObj(json);
    });
}

module.exports.parse = parse;
