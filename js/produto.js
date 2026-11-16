
const { chromium } = require("playwright");

async function extrairDadosProdutoOLX(url) {
    let browser;

    try {
        browser = await chromium.launch({
            headless: false
        });

        const page = await browser.newPage();

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForTimeout(5000);

        const dados = await page.evaluate(() => {
            const body = document.body.innerText || "";

            const linhas = body
                .split("\n")
                .map(linha => linha.trim())
                .filter(Boolean);

            // Verifica se a OLX bloqueou o acesso
            const acessoBloqueado = [
                /sorry, you have been blocked|access denied|acesso negado/i,
                /attention required|unable to access olx|cloudflare ray id/i
            ].some(expressao => expressao.test(body));

            if (acessoBloqueado) {
                throw new Error(
                    "A OLX bloqueou temporariamente o acesso ao anúncio. " +
                    "Aguarde alguns minutos e tente novamente."
                );
            }

            // Lê os dados estruturados da página
            const jsonLD = [
                ...document.querySelectorAll(
                    'script[type="application/ld+json"]'
                )
            ].map(script => {
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
                item["@type"] === "Product" ||
                (
                    Array.isArray(item["@type"]) &&
                    item["@type"].includes("Product")
                )
            ) || {};

            const oferta = Array.isArray(produto.offers)
                ? produto.offers[0]
                : produto.offers || {};

            // TÍTULO
            const tituloHTML = [
                ...document.querySelectorAll("h1")
            ]
                .filter(elemento => elemento.getClientRects().length)
                .map(elemento => elemento.innerText.trim())
                .find(titulo =>
                    titulo &&
                    !/manage your data|how your data is used/i.test(titulo)
                );

            const titulo =
                produto.name ||
                tituloHTML ||
                "Não encontrado";

            // PREÇO
            const precoElemento = document.querySelector(
                '[data-testid="ad-price"]'
            );

            const preco =
                oferta.price ||
                precoElemento?.innerText?.trim() ||
                body.match(/R\$\s?[\d.]+(?:,\d{2})?/)?.[0] ||
                "Não encontrado";

            // DESCRIÇÃO
            const descricao =
                produto.description ||
                document.querySelector(
                    '[data-testid="ad-description"]'
                )?.innerText?.trim() ||
                "Não encontrado";

            // VENDEDOR
            const vendedorEstruturado = Array.isArray(produto.seller)
                ? produto.seller[0]
                : produto.seller;

            const nomeVendedorJSON =
                typeof vendedorEstruturado === "string"
                    ? vendedorEstruturado.trim()
                    : typeof vendedorEstruturado?.name === "string"
                        ? vendedorEstruturado.name.trim()
                        : "";

            const nomeVendedorHTML = [
                ...document.querySelectorAll(
                    'span[class*="profile__name"], ' +
                    '[data-testid*="seller-name"], ' +
                    '[data-testid*="profile-name"]'
                )
            ]
                .filter(elemento => elemento.getClientRects().length)
                .map(elemento => elemento.innerText.trim())
                .find(nome =>
                    nome &&
                    !/sobre o anunciante|conta verificada/i.test(nome)
                );

            const nomeDono =
                nomeVendedorHTML ||
                nomeVendedorJSON ||
                "Não encontrado";

            // LOCALIZAÇÃO
            const indiceLocalizacao = linhas.findIndex(linha =>
                linha.toLowerCase() === "localização"
            );

            let localizacao = "Não encontrado";

            if (indiceLocalizacao >= 0) {
                const partes = linhas.slice(
                    indiceLocalizacao + 1,
                    indiceLocalizacao + 3
                );

                if (partes.length) {
                    localizacao = partes.join(", ");
                }
            }

            // IMAGENS DO ANÚNCIO
            const imagens = [
                ...new Set(
                    [...document.querySelectorAll("img")]
                        .map(img =>
                            img.getAttribute("src") ||
                            img.getAttribute("data-src")
                        )
                        .filter(src =>
                            src &&
                            src.includes("img.olx.com.br/images/")
                        )
                )
            ];

            return {
                titulo,
                preco: String(preco),
                nomeDono,
                descricao,
                localizacao,
                imagens,
                url: location.href,
                dataExtracao: new Date().toISOString()
            };
        });

        if (
            !dados.titulo ||
            dados.titulo === "Não encontrado"
        ) {
            throw new Error(
                "Não foi possível identificar o título do anúncio."
            );
        }

        return {
            sucesso: true,
            dados
        };

    } catch (erro) {
        console.error("Erro ao extrair produto OLX:", erro.message);

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
