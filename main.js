#!/usr/bin/env node
const fs = require('fs-extra');
const program = require('commander');
const http = require('http');
const execSync = require('child_process').execSync;
const execAsync = require('child_process').exec;
const tsc = require('typescript');
const path = require('path');
const WebSocket = require('ws');
const chokidar = require('chokidar');
const esprima = require('esprima');
const resolveBareSpecifier = require('./resolve-bare-specifier');

program
    .version('0.17.1')
    .option('-p, --port [port]', 'Specify the server\'s port')
    .option('-w, --watch-files', 'Watch files in current directory and reload browser on changes')
    .option('--ts-warning', 'Report TypeScript errors in the browser console as warnings')
    .option('--ts-error', 'Report TypeScript errors in the browser console as errors')
    .option('--build-static', 'Create a static build of the current working directory. The output will be in a directory called dist in the current working directory')
    .option('--install-wasm', 'Install the WebAssembly toolchain to allow importing of C/C++ files')
    .option('--target [target]', 'The ECMAScript version to compile to; if omitted, defaults to ES5. Any targets supported by the TypeScript compiler are supported here (ES3, ES5, ES6/ES2015, ES2016, ES2017, ESNext)')
    .option('--disable-spa', 'Disable the SPA redirect to index.html')
    .option('--exclude-dirs', 'A space-separated list of directories to exclude from the static build') //TODO I know this is wrong, I need to figure out how to do variadic arguments
    .parse(process.argv);
// end side-causes
// start pure operations, generate the data
const buildStatic = program.buildStatic;
const installWasm = program.installWasm;
const watchFiles = program.watchFiles;
// const spaRoot = program.spaRoot || 'index.html';
const nodePort = +(program.port || 5000);
const webSocketPort = nodePort + 1;
const tsWarning = program.tsWarning;
const tsError = program.tsError;
const target = program.target || 'ES5';
const nodeHttpServer = createNodeServer(http, nodePort, webSocketPort, watchFiles, tsWarning, tsError, target);
const webSocketServer = createWebSocketServer(webSocketPort, watchFiles);
const excludeDirs = program.excludeDirs;
const excludeDirsRegex = `^${excludeDirs ? program.args.join('|') : 'NO_EXCLUDE_DIRS'}`;
const disableSpa = program.disableSpa;
let clients = {};
let compiledFiles = {};
//end pure operations
// start side-effects, change the world
if (installWasm) {
    const asyncExec = execAsync(`
        echo "Installing WebAssembly toolchain (this could take a long time)"
        git clone https://github.com/juj/emsdk.git
        cd emsdk
        ./emsdk install --build=Release sdk-incoming-64bit binaryen-master-64bit
        ./emsdk activate --build=Release sdk-incoming-64bit binaryen-master-64bit
    `, {
        shell: '/bin/bash'
    }, () => {
        process.exit();
    });
    asyncExec.stdout.pipe(process.stdout);
    asyncExec.stderr.pipe(process.stderr);
    return;
}

nodeHttpServer.listen(nodePort);
console.log(`Zwitterion listening on port ${nodePort}`);
process.send && process.send('ZWITTERION_LISTENING');

if (buildStatic) {
    const asyncExec = execAsync(`
        echo "Copy current working directory to ZWITTERION_TEMP directory"

        originalDirectory=$(pwd)

        rm -rf dist
        cd ..
        rm -rf ZWITTERION_TEMP
        cp -r $originalDirectory ZWITTERION_TEMP
        cd ZWITTERION_TEMP

        echo "Download and save all .html files from Zwitterion"

        shopt -s globstar
        for file in **/*.html; do
            if [[ ! $file =~ ${excludeDirsRegex} ]]
            then
                wget -q -x -nH "http://localhost:${nodePort}/$file"
            fi
        done

        echo "Download and save all .js files from Zwitterion"

        shopt -s globstar
        for file in **/*.js; do
            if [[ ! $file =~ ${excludeDirsRegex} ]]
            then
                wget -q -x -nH "http://localhost:${nodePort}/$\{file%.*\}.js"
            fi
        done

        echo "Download and save all .ts files from Zwitterion"

        shopt -s globstar
        for file in **/*.ts; do
            if [[ ! $file =~ ${excludeDirsRegex} ]]
            then
                wget -q -x -nH "http://localhost:${nodePort}/$\{file%.*\}.js"
            fi
        done

        echo "Download and save all .tsx files from Zwitterion"

        shopt -s globstar
        for file in **/*.tsx; do
            if [[ ! $file =~ ${excludeDirsRegex} ]]
            then
                wget -q -x -nH "http://localhost:${nodePort}/$\{file%.*\}.js"
            fi
        done

        echo "Download and save all .jsx files from Zwitterion"

        shopt -s globstar
        for file in **/*.jsx; do
            if [[ ! $file =~ ${excludeDirsRegex} ]]
            then
                wget -q -x -nH "http://localhost:${nodePort}/$\{file%.*\}.js"
            fi
        done

        #echo "Download and save all .c files from Zwitterion"

        #shopt -s globstar
        #for file in **/*.c; do
        #    if [[ ! $file =~ ${excludeDirsRegex} ]]
        #    then
        #        wget -q -x -nH "http://localhost:${nodePort}/$\{file%.*\}.js"
        #    fi
        #done

        #echo "Download and save all .cc files from Zwitterion"

        #shopt -s globstar
        #for file in **/*.cc; do
        #    if [[ ! $file =~ ${excludeDirsRegex} ]]
        #    then
        #        wget -q -x -nH "http://localhost:${nodePort}/$\{file%.*\}.js"
        #    fi
        #done

        #echo "Download and save all .cpp files from Zwitterion"

        #shopt -s globstar
        #for file in **/*.cpp; do
        #    if [[ ! $file =~ ${excludeDirsRegex} ]]
        #    then
        #        wget -q -x -nH "http://localhost:${nodePort}/$\{file%.*\}.js"
        #    fi
        #done

        #echo "Download and save all .wasm files from Zwitterion"

        #shopt -s globstar
        #for file in **/*.wasm; do
        #    if [[ ! $file =~ ${excludeDirsRegex} ]]
        #    then
        #        wget -q -x -nH "http://localhost:${nodePort}/$\{file%.*\}.js"
        #    fi
        #done

        echo "Copy ZWITTERION_TEMP to dist directory in the project root directory"

        cd ..
        cp -r ZWITTERION_TEMP $originalDirectory/dist
        rm -rf ZWITTERION_TEMP

        echo "Static build finished"
    `, {
        shell: '/bin/bash'
    }, () => {
        process.exit();
    });
    asyncExec.stdout.pipe(process.stdout);
    asyncExec.stderr.pipe(process.stderr);
    return;
}

// end side-effects
function createNodeServer(http, nodePort, webSocketPort, watchFiles, tsWarning, tsError, target) {
    return http.createServer(async (req, res) => {
        const fileExtension = req.url.slice(req.url.lastIndexOf('.') + 1);

        switch (fileExtension) {
            case '/': {
                const indexFileContents = (await fs.readFile(`./index.html`)).toString();
                const modifiedIndexFileContents = modifyHTML(indexFileContents, 'index.html', watchFiles, webSocketPort);
                res.end(modifiedIndexFileContents);
                return;
            }
            case 'html': {
                throw new Error('html file extension not implemented');
                return;
            }
            case 'js': {
                await handleScriptExtension(req, res);
                return;
            }
            case 'ts': {
                await handleScriptExtension(req, res);
                return;
            }
            case req.url: {
                await handleBareSpecifier(req, res);
                return;
            }
            default: {
                throw new Error('There is a major problem. This should never happen');
                return;
            }
        }

        // if (rootPathResult) {
        // }

        // const extension = req.url.

        // const jsExtensionResult = handleExtension(req.url);
        // handleHTMLExtension;
        // handleJSExtension;
        // handleNoExtension;


        // const normalizedReqURL = req.url === '/' ? '/index.html' : req.url;

        // if (handleRootPath(req.url, watchFile, watchFiles, fs, modifyHTML)) return;
        //
        // if (req.url === '/') {
        //     return;
        // }

        // const normalizedReqUrl = req.url === '/' ? '/index.html' : req.url;
        // const filePathWithDot = normalizedReqUrl.slice(0, normalizedReqUrl.lastIndexOf('.') + 1);
        // const resolvedBareSpecifier = resolveBareSpecifier(normalizedReqUrl === '/index.html' ? '/index.html' : normalizedReqUrl.slice(1));
        // console.log('resolvedBareSpecifier', resolvedBareSpecifier)
        // // const resolvedBareSpecifierWithDot = resolvedBareSpecifier.slice(0, resolvedBareSpecifier.lastIndexOf('.') + 1);
        // // console.log('resolvedBareSpecifier', resolvedBareSpecifier);
        // const fileExtensionWithoutDot = normalizedReqUrl.slice(normalizedReqUrl.lastIndexOf('.') + 1);
        // console.log('fileExtensionWithoutDot', fileExtensionWithoutDot)
        // const directoryPath = normalizedReqUrl.slice(0, normalizedReqUrl.lastIndexOf('/')) || '/';
        // switch (fileExtensionWithoutDot) {
        //     case 'html': {
        //         if (fs.existsSync(`.${normalizedReqUrl}`)) {
        //             watchFile(`.${normalizedReqUrl}`, watchFiles);
        //             const fileText = fs.readFileSync(`.${normalizedReqUrl}`).toString();
        //             res.end(modifyHTML(fileText, directoryPath, watchFiles, webSocketPort));
        //             return;
        //         }
        //         else {
        //             if (!disableSpa) {
        //                 res.end(modifyHTML(fs.readFileSync(`./index.html`).toString(), directoryPath, watchFiles, webSocketPort));
        //             }
        //             else {
        //                 res.statusCode = 404;
        //                 res.end();
        //             }
        //             return;
        //         }
        //     }
        //     case 'js': {
        //         if (compiledFiles[`.${filePathWithDot}ts`]) {
        //             res.end(compiledFiles[`.${filePathWithDot}ts`]);
        //             return;
        //         }
        //         else if (fs.existsSync(`.${filePathWithDot}ts`)) {
        //             const typeScriptErrorsString = getTypeScriptErrorsString(`.${filePathWithDot}ts`, tsWarning, tsError);
        //             watchFile(`.${filePathWithDot}ts`, watchFiles);
        //             const sourceText = fs.readFileSync(`.${filePathWithDot}ts`).toString();
        //             const esModuleCompiledSourceText = compileToJs(sourceText, 'es2015', target, null);
        //             const isModule = determineIfModule(esModuleCompiledSourceText);
        //             const moduleFormat = isModule ? 'system' : 'es2015';
        //             const compiledSourceText = compileToJs(sourceText, moduleFormat, target, null);
        //             const compiledSourceTextWithErrorsString = `${compiledSourceText}${typeScriptErrorsString}`;
        //             compiledFiles[`.${filePathWithDot}ts`] = compiledSourceTextWithErrorsString;
        //             res.end(compiledSourceTextWithErrorsString);
        //             return;
        //         }
        //         else if (compiledFiles[`.${filePathWithDot}tsx`]) {
        //             res.end(compiledFiles[`.${filePathWithDot}tsx`]);
        //             return;
        //         }
        //         else if (fs.existsSync(`.${filePathWithDot}tsx`)) {
        //             const typeScriptErrorsString = getTypeScriptErrorsString(`.${filePathWithDot}tsx`, tsWarning, tsError);
        //             watchFile(`.${filePathWithDot}tsx`, watchFiles);
        //             const sourceText = fs.readFileSync(`.${filePathWithDot}tsx`).toString();
        //             const esModuleCompiledSourceText = compileToJs(sourceText, 'es2015', target, 'react');
        //             const isModule = determineIfModule(esModuleCompiledSourceText);
        //             const moduleFormat = isModule ? 'system' : 'es2015';
        //             const compiledSourceText = compileToJs(sourceText, moduleFormat, target, 'react');
        //             const compiledSourceTextWithErrorsString = `${compiledSourceText}${typeScriptErrorsString}`;
        //             compiledFiles[`.${filePathWithDot}tsx`] = compiledSourceTextWithErrorsString;
        //             res.end(compiledSourceTextWithErrorsString);
        //             return;
        //         }
        //         else if (compiledFiles[`.${filePathWithDot}jsx`]) {
        //             res.end(compiledFiles[`.${filePathWithDot}jsx`]);
        //             return;
        //         }
        //         else if (fs.existsSync(`.${filePathWithDot}jsx`)) {
        //             watchFile(`.${filePathWithDot}jsx`, watchFiles);
        //             const sourceText = fs.readFileSync(`.${filePathWithDot}jsx`).toString();
        //             const esModuleCompiledSourceText = compileToJs(sourceText, 'es2015', target, 'react');
        //             const isModule = determineIfModule(esModuleCompiledSourceText);
        //             const moduleFormat = isModule ? 'system' : 'es2015';
        //             const compiledSourceText = compileToJs(sourceText, moduleFormat, target, 'react');
        //             compiledFiles[`.${filePathWithDot}jsx`] = compiledSourceText;
        //             res.end(compiledSourceText);
        //             return;
        //         }
        //         else if (compiledFiles[`.${filePathWithDot}c`]) {
        //             res.end(compiledFiles[`.${filePathWithDot}c`]);
        //             return;
        //         }
        //         else if (fs.existsSync(`.${filePathWithDot}c`)) {
        //             watchFile(`.${filePathWithDot}c`, watchFiles);
        //             const wasmJsCompiledSourceText = await compileToWasmJs(`.${filePathWithDot}c`);
        //             compiledFiles[`.${filePathWithDot}c`] = wasmJsCompiledSourceText;
        //             res.end(wasmJsCompiledSourceText);
        //             return;
        //         }
        //         else if (compiledFiles[`.${filePathWithDot}cc`]) {
        //             res.end(compiledFiles[`.${filePathWithDot}cc`]);
        //             return;
        //         }
        //         else if (fs.existsSync(`.${filePathWithDot}cc`)) {
        //             watchFile(`.${filePathWithDot}cc`, watchFiles);
        //             const wasmJsCompiledSourceText = await compileToWasmJs(`.${filePathWithDot}cc`);
        //             compiledFiles[`.${filePathWithDot}cc`] = wasmJsCompiledSourceText;
        //             res.end(wasmJsCompiledSourceText);
        //             return;
        //         }
        //         else if (compiledFiles[`.${filePathWithDot}cpp`]) {
        //             res.end(compiledFiles[`.${filePathWithDot}cpp`]);
        //             return;
        //         }
        //         else if (fs.existsSync(`.${filePathWithDot}cpp`)) {
        //             watchFile(`.${filePathWithDot}cpp`, watchFiles);
        //             const wasmJsCompiledSourceText = await compileToWasmJs(`.${filePathWithDot}cpp`);
        //             compiledFiles[`.${filePathWithDot}cpp`] = wasmJsCompiledSourceText;
        //             res.end(wasmJsCompiledSourceText);
        //             return;
        //         }
        //         else if (compiledFiles[`.${normalizedReqUrl}`]) {
        //             res.end(compiledFiles[`.${normalizedReqUrl}`]);
        //             return;
        //         }
        //         else {
        //             if (fs.existsSync(`.${normalizedReqUrl}`)) {
        //                 watchFile(`.${normalizedReqUrl}`, watchFiles);
        //                 const sourceText = fs.readFileSync(`.${normalizedReqUrl}`).toString();
        //                 const isModule = determineIfModule(sourceText);
        //                 const moduleFormat = isModule ? 'system' : 'es2015';
        //                 const compiledSourceText = compileToJs(sourceText, moduleFormat, target, null);
        //                 compiledFiles[`.${normalizedReqUrl}`] = compiledSourceText;
        //                 res.end(compiledSourceText);
        //                 return;
        //             }
        //             else {
        //                 if (!disableSpa) {
        //                     res.end(modifyHTML(fs.readFileSync(`./index.html`).toString(), directoryPath, watchFiles, webSocketPort));
        //                 }
        //                 else {
        //                     res.statusCode = 404;
        //                     res.end();
        //                 }
        //                 return;
        //             }
        //         }
        //     }
        //     default: {
        //         if (fs.existsSync(`.${normalizedReqUrl}`)) {
        //             watchFile(`.${normalizedReqUrl}`, watchFiles);
        //             res.end(fs.readFileSync(`.${normalizedReqUrl}`));
        //             return;
        //         }
        //         else {
        //             if (!disableSpa) {
        //                 res.end(modifyHTML(fs.readFileSync(`./index.html`).toString(), directoryPath, watchFiles, webSocketPort));
        //             }
        //             else {
        //                 res.statusCode = 404;
        //                 res.end();
        //             }
        //             return;
        //         }
        //     }
        // }
    });
}

async function handleScriptExtension(req, res) {
    //TODO First we compile to ES2015
    //TODO Second we convert all requires to ES modules
    //TODO Third we parse and change all URLS to be path URLS with file extensions

    const nodeFilePath = `.${req.url}`;

    // check if the file is in the cache
    if (compiledFiles[nodeFilePath]) {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(compiledFiles[nodeFilePath]);
        return;
    }

    // the file is not in the cache
    // watch the file if necessary
    // compile the file and return the compiled source
    if (await fs.exists(nodeFilePath)) {
        watchFile(nodeFilePath, watchFiles);
        const source = (await fs.readFile(nodeFilePath)).toString();
        const compiledToJS = compileToJs(source, target, null);
        const compiledToESModules = compileToESModules(compiledToJS);
        const transformedSpecifiers = transformSpecifiers(compiledToESModules);
        compiledFiles[nodeFilePath] = transformedSpecifiers;
        res.setHeader('Content-Type', 'application/javascript');
        res.end(transformedSpecifiers);
        return;
    }

    // if SPA is enabled, return the contents to index.html
    // if SPA is not enabled, return a 404 error
    if (!disableSpa) {
        const indexFileContents = (await fs.readFile(`./index.html`)).toString();
        const modifiedIndexFileContents = modifyHTML(indexFileContents, 'index.html', watchFiles, webSocketPort);
        const directoryPath = req.url.slice(0, req.url.lastIndexOf('/')) || '/';
        res.end(modifyHTML(modifiedIndexFileContents, directoryPath, watchFiles, webSocketPort));
        return;
    }
    else {
        res.statusCode = 404;
        res.end();
        return;
    }
}

//TODO there is a lot of repeat code between this function and the handleExplicitScriptExtension function
// async function handleBareSpecifier(req, res) {
//     //first we check for if the file exists without the extension
//     const nodeFilePath = `.${req.url}`;
//
//     if (compiledFiles[nodeFilePath]) {
//         res.end(compiledFiles[nodeFilePath]);
//         return;
//     }
//
//     if (await fs.exists(nodeFilePath)) {
//         watchFile(nodeFilePath, watchFiles);
//         const sourceText = (await fs.readFile(nodeFilePath)).toString();
//         const isModule = determineIfModule(sourceText);
//         const moduleFormat = isModule ? 'system' : 'es2015';
//         const compiledSourceText = compileToJs(sourceText, moduleFormat, target, null);
//         compiledFiles[nodeFilePath] = compiledSourceText;
//         res.end(compiledSourceText);
//         return;
//     }
//
//     //second we check if the file is a TS file (extensions are omitted from imports)
//     const tsNodeFilePath = `.${req.url}.ts`;
//
//     if (compiledFiles[tsNodeFilePath]) {
//         res.end(compiledFiles[tsNodeFilePath]);
//         return;
//     }
//
//     if (await fs.exists(tsNodeFilePath)) {
//         watchFile(tsNodeFilePath, watchFiles);
//         const sourceText = (await fs.readFile(tsNodeFilePath)).toString();
//         const isModule = determineIfModule(sourceText);
//         const moduleFormat = isModule ? 'system' : 'es2015';
//         const compiledSourceText = compileToJs(sourceText, moduleFormat, target, null);
//         compiledFiles[tsNodeFilePath] = compiledSourceText;
//         res.end(compiledSourceText);
//         return;
//     }
//
//     //finally we check if it is a node module
//     try {
//         const resolvedNodeFilePath = resolveBareSpecifier(req.url.slice(1));
//
//         if (compiledFiles[resolvedNodeFilePath]) {
//             res.end(compiledFiles[resolvedNodeFilePath]);
//             return;
//         }
//
//         if (await fs.exists(resolvedNodeFilePath)) {
//             watchFile(resolvedNodeFilePath, watchFiles);
//             const sourceText = (await fs.readFile(resolvedNodeFilePath)).toString();
//             const isModule = determineIfModule(sourceText);
//             const moduleFormat = isModule ? 'system' : 'es2015';
//             const compiledSourceText = compileToJs(sourceText, moduleFormat, target, null);
//             compiledFiles[resolvedNodeFilePath] = compiledSourceText;
//             res.end(compiledSourceText);
//             return;
//         }
//
//     }
//     catch(error) {
//         if (!disableSpa) {
//             const indexFileContents = (await fs.readFile(`./index.html`)).toString();
//             const modifiedIndexFileContents = modifyHTML(indexFileContents, 'index.html', watchFiles, webSocketPort);
//             const directoryPath = req.url.slice(0, req.url.lastIndexOf('/')) || '/';
//             res.end(modifyHTML(modifiedIndexFileContents, directoryPath, watchFiles, webSocketPort));
//             return;
//         }
//         else {
//             res.statusCode = 404;
//             res.end();
//             return;
//         }
//     }
// }

// function handleExtension(req.url, extension) {
//     const filePath =
//
//     if (compiledFiles[`.${filePathWithDot}ts`]) {
//         res.end(compiledFiles[`.${filePathWithDot}ts`]);
//         return;
//     }
//     else if (fs.existsSync(`.${filePathWithDot}ts`)) {
//         const typeScriptErrorsString = getTypeScriptErrorsString(`.${filePathWithDot}ts`, tsWarning, tsError);
//         watchFile(`.${filePathWithDot}ts`, watchFiles);
//         const sourceText = fs.readFileSync(`.${filePathWithDot}ts`).toString();
//         const esModuleCompiledSourceText = compileToJs(sourceText, 'es2015', target, null);
//         const isModule = determineIfModule(esModuleCompiledSourceText);
//         const moduleFormat = isModule ? 'system' : 'es2015';
//         const compiledSourceText = compileToJs(sourceText, moduleFormat, target, null);
//         const compiledSourceTextWithErrorsString = `${compiledSourceText}${typeScriptErrorsString}`;
//         compiledFiles[`.${filePathWithDot}ts`] = compiledSourceTextWithErrorsString;
//         res.end(compiledSourceTextWithErrorsString);
//         return;
//     }
// }

function getTypeScriptErrorsString(filePath, tsWarning, tsError) {
    if (tsWarning || tsError) {
        const tsProgram = tsc.createProgram([
            filePath
        ], {});
        const semanticDiagnostics = tsProgram.getSemanticDiagnostics();
        return semanticDiagnostics.reduce((result, diagnostic) => {
            return `${result}\nconsole.${tsWarning ? 'warn' : 'error'}("TypeScript: ${diagnostic.file ? diagnostic.file.fileName : 'no file name provided'}: ${diagnostic.messageText}")`;
        }, '');
    }
    else {
        return '';
    }
}

function watchFile(filePath, watchFiles) {
    if (watchFiles) {
        chokidar.watch(filePath).on('change', () => {
            compiledFiles[filePath] = null;
            Object.values(clients).forEach((client) => {
                try {
                    client.send('RELOAD_MESSAGE');
                }
                catch(error) {
                    //TODO something should be done about this. What's happening I believe is that if two files are changed in a very short period of time, one file will start the browser reloading, and the other file will try to send a message to the browser while it is reloading, and thus the websocket connection will not be established with the browser. This is a temporary solution
                    console.log(error);
                }
            });
        });
    }
}

function modifyHTML(originalText, directoryPath, watchFiles, webSocketPort) {
    const text = originalText.includes('<head>') && watchFiles ? originalText.replace('<head>', `<head>
        <script>
            let socket = new WebSocket('ws://localhost:${webSocketPort}');
            socket.addEventListener('message', (message) => {
                window.location.reload();
            });
        </script>
    `) : originalText;

    return text;
}

function compileToJs(source, target, jsx) {
    const transpileOutput = tsc.transpileModule(source, {
        compilerOptions: {
            module: 'es2015',
            target,
            jsx
        }
    });
    return transpileOutput.outputText;
}

function compileToESModules(source) {
    return source;
}

function transformSpecifiers(source) {
    return source;
}

function createWebSocketServer(webSocketPort, watchFiles) {
    if (watchFiles) {
        const webSocketServer = new WebSocket.Server({
            port: webSocketPort
        });
        webSocketServer.on('connection', (client, request) => {
            clients[request.connection.remoteAddress] = client;
	    client.on('error', (error) => {
	    	console.log('web socket client error', error);
	    });
        });
        return webSocketServer;
    }
    else {
        return null;
    }
}

async function compileToWasmJs(filePath) {
    const filename = filePath.substring(filePath.lastIndexOf('/') + 1, filePath.lastIndexOf('.'));
    execSync(`cd emsdk && source ./emsdk_env.sh --build=Release && cd .. && emcc ${filePath} -s WASM=1 -o ${filename}.wasm`, {shell: '/bin/bash'});
    const compiledText = fs.readFileSync(`${filename}.js`).toString();
    return compiledText;
}
