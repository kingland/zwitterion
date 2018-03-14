//TODO arbitrary script tags in body
//TODO bare specifiers should load the file first, the ts file second, and then the node module
//TODO Have one test for loading arbitrary html files that aren't the index.html file, and all of their dependencies

declare var jsverify: any;
declare var fs: any;

const PAGE_LOADED = 'PAGE_LOADED';
const GET_RESULT = 'GET_RESULT';
const RESULT = 'RESULT';

import {
    arbPort,
    loadZwitterion,
    getPromisePieces,
    arbScriptElementsInfo,
    wait
} from './test-utilities';

class ZwitterionTest extends HTMLElement {
    prepareTests(test: any) {
        test('Load an arbitrary index html file and all of its scripts', [jsverify.number, arbPort, arbScriptElementsInfo], async (arbNumber: number, arbPort: number, arbScriptElementsInfo: any) => {
            for (let i=0; i < arbScriptElementsInfo.length; i++) {
                //TODO if this works, make sure to delete the node_modules created
                const arbScriptElementInfo = arbScriptElementsInfo[i];
                // if (arbScriptElementInfo.extension === '' && arbScriptElementInfo.nodeModule) {
                //     await fs.outputFile(`./node_modules/${arbScriptElementInfo.fileName}/${arbScriptElementInfo.fileName}.js`, arbScriptElementInfo.contents);
                //     await fs.outputFile(`./node_modules/${arbScriptElementInfo.fileName}/package.json`, `
                //         {
                //             "main": "./${arbScriptElementInfo.fileName}.js"
                //         }
                //     `);
                // }
                // else {
                    await fs.outputFile(arbScriptElementInfo.srcPath, arbScriptElementInfo.contents);
                // }
            }

            const html = `
                <!DOCTYPE html>

                <html>
                    <head>
                        <script>
                            window.addEventListener('load', (e) => {
                                window.opener.postMessage({
                                    type: '${PAGE_LOADED}'
                                });
                            });

                            window.addEventListener('message', (e) => {
                                if (e.data === '${GET_RESULT}') {
                                    window.opener.postMessage({
                                        type: '${RESULT}',
                                        body: document.body.innerText,
                                        zwitterionTest: window.ZWITTERION_TEST
                                    });
                                }
                            });
                        </script>

                        ${arbScriptElementsInfo.map((arbScriptElementInfo: any) => {
                            return arbScriptElementInfo.element;
                        }).join('\n')}
                    </head>

                    <body>${arbNumber}</body>
                </html>
            `;
            await fs.writeFile('./index.html', html);

            const zwitterionProcess = await loadZwitterion(arbPort);
            const {thePromise, theResolve} = getPromisePieces();
            window.addEventListener('message', async (e) => {
                if (e.data.type === PAGE_LOADED) {
                    // await wait(5000);
                    testWindow.postMessage(GET_RESULT, `http://localhost:${arbPort}`);
                }

                if (e.data.type === RESULT) {
                    //TODO we really need to remove this event listener
                    const bodyHasCorrectContent = +e.data.body === arbNumber;
                    const allScriptsExecuted = (e.data.zwitterionTest === undefined && arbScriptElementsInfo.length === 0) ||
                                                e.data.zwitterionTest && arbScriptElementsInfo.filter((arbScriptElementInfo: any) => {
                                                                                return !e.data.zwitterionTest[arbScriptElementInfo.srcPath];
                                                                            }).length === 0;

                    if (
                        bodyHasCorrectContent &&
                        allScriptsExecuted
                    ) {
                        theResolve(true);
                    }
                    else {
                        theResolve(false);
                    }
                }
            });

            const testWindow = window.open(`http://localhost:${arbPort}`, '_blank');

            const result = await thePromise;

            (<any> zwitterionProcess).kill('SIGINT');
            await fs.unlink('./index.html');
            for (let i=0; i < arbScriptElementsInfo.length; i++) {
                const arbScriptElementInfo = arbScriptElementsInfo[i];
                await fs.remove(`./${arbScriptElementInfo.topLevelDirectory || arbScriptElementInfo.srcPath}`);
            }

            return result;
        });

        // test('Load a file that does not exist');
        // test('Load a file that does not exist with SPA support disabled');
    }
}

window.customElements.define('zwitterion-test', ZwitterionTest);
