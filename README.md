# om30-vortex

Userscripts para facilitar o registro de visitas no Vortex e o lançamento de chamados no GLPI.

## Pré-requisitos

Instale o [Tampermonkey](https://www.tampermonkey.net/) no navegador e permita a execução de userscripts nas configurações da extensão e do navegador.

Os scripts funcionam em [vortexom30.replit.app](https://vortexom30.replit.app/). A integração GLPI também funciona em [suporte.om30.cloud](https://suporte.om30.cloud/). É necessário ter acesso aos sistemas.

## Scripts disponíveis

### [Vortex — rascunho persistente e offline](https://raw.githubusercontent.com/otowm/om30-vortex/main/vortex-rascunho-offline.user.js)

Versão **1.2.1**.

- Guarda o rascunho da Nova Visita para sobreviver ao fechamento da aba ou do app.
- Permite ajustar ou reiniciar o horário de início e descartar o rascunho.
- Registra o service worker do Vortex e prepara os arquivos da página para uso offline.
- Direciona o login para a página de acesso do cliente.
- Mostra o estado do rascunho e do offline na nuvenzinha.

Abra o sistema com internet antes de usar o modo offline, para preparar o cache.

### [Vortex — lançar visita no GLPI](https://raw.githubusercontent.com/otowm/om30-vortex/main/vortex-glpi.user.js)

Versão **1.7.3**.

- Prepara um chamado com os dados da visita, incluindo título, descrição, data, duração, localização, categoria e atores.
- Oferece o lançamento ao finalizar a visita e no detalhe de uma ficha.
- Salva rascunhos do GLPI e permite continuar o preenchimento depois.
- Mostra pendências e vínculos com chamados em Minhas Visitas.
- Inclui um link para a ficha no Histórico, com filtro de data e busca pelo nome da unidade. Com o script ativo no Vortex, tenta abrir a ficha correspondente.

Revise os dados e clique em **Adicionar** no GLPI. O script não envia o chamado automaticamente.

Ao lançar novamente uma ficha que já tem rascunho, o script retoma esse rascunho e preserva suas edições. Links já gravados em chamados antigos não são alterados.

## Como instalar

1. Instale e ative o Tampermonkey.
2. Clique no nome do script desejado acima.
3. Confirme a instalação na tela do Tampermonkey.
4. Recarregue o Vortex e, para a integração, o GLPI.

Os dois scripts podem ser usados juntos ou separadamente.

## Como atualizar

Os scripts têm endereços de atualização apontando para este repositório. Use a opção de verificar atualizações do Tampermonkey ou abra novamente o link de instalação e confirme a atualização.

Se você instalou uma versão local anterior à publicação no GitHub, atualize uma vez pelos links acima para configurar a origem das próximas atualizações.
