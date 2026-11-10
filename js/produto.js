const puppeteer = require("puppeteer");

async function extrairDadosProdutoOLX(url) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--start-maximized",
      ],
    });
    const page = await browser.newPage();

    // User-Agent realista para evitar o bloqueio anti-bot (Cloudflare) da OLX
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // espera seletor que sempre aparece (ajusta se precisar)
    await page
      .waitForSelector("span.typo-body-small.text-neutral-120.font-regular", {
        timeout: 8000,
      })
      .catch(() => {
        /* ignora se não aparecer */
      });
    await page.waitForSelector("h1", { timeout: 8000 }).catch(() => {
      /* ignora se não aparecer */
    });

    const dados = await page.evaluate(() => {
      // helpers (DOM puro)
      const textOf = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.innerText.trim() : null;
      };

      const allTexts = (sel) => {
        const nodes = Array.from(document.querySelectorAll(sel) || []);
        return nodes.map((n) => n.innerText.trim());
      };

      const obterImagens = () =>
        Array.from(document.querySelectorAll("img"))
          .map((img) => img.src)
          .filter((src) => src && src.includes("olx"));

      // Lê o JSON-LD (dados estruturados estáveis) do anúncio.
      // Mais confiável que classes CSS, que a OLX gera com nomes aleatórios.
      const lerJsonLd = () => {
        const scripts = Array.from(
          document.querySelectorAll('script[type="application/ld+json"]')
        );
        for (const s of scripts) {
          try {
            const obj = JSON.parse(s.textContent);
            const candidatos = Array.isArray(obj) ? obj : [obj];
            const produto = candidatos.find(
              (c) => c && c["@type"] === "Product"
            );
            if (produto) return produto;
          } catch (e) {
            /* ignora JSON inválido */
          }
        }
        return null;
      };
      const ld = lerJsonLd();

      // Imagens vindas do JSON-LD (contentUrl), mais confiáveis
      const imagensLd =
        ld && Array.isArray(ld.image)
          ? ld.image
              .map((i) => (typeof i === "string" ? i : i && i.contentUrl))
              .filter(Boolean)
          : [];

      // Preço vindo do JSON-LD (offers.price)
      let precoLd = null;
      if (ld && ld.offers) {
        const oferta = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (oferta && oferta.price != null) precoLd = String(oferta.price);
      }

      // pega todos os spans com a classe
      const spans = allTexts(
        "span.typo-body-small.text-neutral-120.font-regular"
      );

      // 1) tentativa direta: segundo span (índice 1)
      let localizacao = spans && spans.length > 1 ? spans[1] : null;

      // 2) fallback: procura um span com vírgula (ex: "Cidade, Estado")
      if (!localizacao) {
        const withComma = spans.find((s) => s && s.includes(","));
        if (withComma) localizacao = withComma;
      }

      // 3) fallback extra: procura pelo SVG de localização (baseado no path único)
      if (!localizacao) {
        try {
          const pathElems = Array.from(document.querySelectorAll("svg path"));
          const match = pathElems.find(
            (p) =>
              p.getAttribute("d") &&
              p.getAttribute("d").includes("17.0444645,19.6408084")
          );
          if (match) {
            // sobe até o container e pega o span dentro dele
            const container = match.closest(".flex") || match.closest("div");
            const span = container
              ? container.querySelector(
                  "span.typo-body-small.text-neutral-120.font-regular"
                )
              : null;
            if (span) localizacao = span.innerText.trim();
          }
        } catch (e) {
          // ignora
        }
      }

      // Preço via DOM (fallback) — remove "R$" e pontos de milhar
      const precoDom =
        (
          textOf(
            "#price-box-container > div.ad__sc-q5xder-1.hoJpM > div:nth-child(1) > div > span > span"
          ) || ""
        )
          .replace("R$", "")
          .replace(/\./g, "")
          .trim() || null;

      // Nome do vendedor: a OLX usa o avatar com alt "Foto de <nome>".
      // As fotos do produto usam "<titulo> - Foto N", então não colidem.
      const nomeDono = (() => {
        const avatar = Array.from(document.querySelectorAll("img")).find(
          (im) => im.alt && /^Foto de\s+/i.test(im.alt)
        );
        if (avatar) {
          const nome = avatar.alt.replace(/^Foto de\s+/i, "").trim();
          if (nome) return nome;
        }
        // fallback: seletor antigo (classe CSS pode mudar)
        return textOf("span.typo-body-large.ad__sc-ypp2u2-4.TTTuh");
      })();

      // resultado final — prioriza o JSON-LD e cai para o DOM quando faltar
      return {
        titulo: (ld && ld.name && ld.name.trim()) || textOf("h1"),
        preco: precoLd || precoDom,
        nomeDono,
        vendasConcluidas: textOf("span.typo-body-large.font-semibold.mr-0-25"),
        descricao:
          (ld && ld.description && ld.description.trim()) ||
          textOf(
            "#description-title > div > div.ad__sc-2mjlki-0.cbbFAE.olx-d-flex.olx-ai-flex-start.olx-fd-column > div > span > span"
          ),
        localizacao,
        imagens: imagensLd.length ? imagensLd : obterImagens(),
        url: window.location.href,
        dataExtracao: new Date().toISOString(),
      };
    });

    await browser.close();
    console.log("Dados extraídos com sucesso:", dados);
    return { sucesso: true, dados };
  } catch (erro) {
    try {
      if (browser) await browser.close();
    } catch (e) {
      /* ignora */
    }
    console.error("Erro na extração:", erro);
    return {
      sucesso: false,
      erro: erro.message,
    };
  }
}


module.exports = { extrairDadosProduto: extrairDadosProdutoOLX };
