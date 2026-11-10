
const { chromium } = require("playwright");

async function extrairDadosProdutoOLX(url) {
    let browser;

    try {
        browser = await chromium.launch({
            headless: true
        });

        const page = await browser.newPage();

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(4000);

        const dados = await page.evaluate(() => {
            const body = document.body.innerText;

            const texto = (regex) => {
                const match = body.match(regex);
                return match ? match[1].trim() : "Não encontrado";
            };

            const jsonLD = [...document.querySelectorAll(
                'script[type="application/ld+json"]'
            )].map(script => {
                try {
                    return JSON.parse(script.textContent);
                } catch {
                    return null;
                }
            }).filter(Boolean);

            const objetos = jsonLD.flatMap(item =>
                Array.isArray(item) ? item : [item]
            );

            const produto = objetos.find(item =>
                item["@type"] === "Product"
            ) || {};

            const oferta = produto.offers || {};

            const titulo =
                produto.name ||
                document.querySelector("h1")?.innerText?.trim() ||
                "Não encontrado";

            const preco =
                oferta.price ||
                document.querySelector('[data-testid="ad-price"]')
                    ?.innerText?.trim() ||
                texto(/R\$\s?([\d.,]+)/) ;

            const descricao =
                produto.description ||
                "Não encontrado";

            const nomeDono = texto(
                /\n([^\n]+)\nÚltimo acesso/
            );

            const localizacao = texto(
                /\n(Recreio, Rio das Ostras - RJ|[^\n]+,\s*Rio das Ostras - RJ)\n/
            );

            const vendasConcluidas = texto(
                /(\d+)\s*\nVendas concluídas/
            );

            const imagens = [
                ...document.querySelectorAll("img")
            ]
                .map(img => img.src)
                .filter(src =>
                    src.includes("img.olx.com.br/images/")
                );

            return {
                titulo,
                preco,
                nomeDono,
                vendasConcluidas,
                descricao,
                localizacao,
                imagens: [...new Set(imagens)],
                url: location.href,
                dataExtracao: new Date().toISOString()
            };
        });

        if (
            dados.titulo === "Não encontrado" ||
            dados.titulo.toLowerCase().includes("blocked")
        ) {
            throw new Error("Não foi possível extrair o anúncio.");
        }

        return {
            sucesso: true,
            dados
        };

    } catch (erro) {
        return {
            sucesso: false,
            erro: erro.message
        };

    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = {
    extrairDadosProduto: extrairDadosProdutoOLX
};
