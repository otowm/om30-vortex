# om30-vortex

Userscripts para facilitar o registro de visitas no Vortex e o lançamento de chamados no GLPI.

## Pré-requisitos

Instale o [Tampermonkey](https://www.tampermonkey.net/) no navegador e permita a execução de userscripts nas configurações da extensão e do navegador.
## Scripts disponíveis

### [Vortex — rascunho persistente e offline](https://raw.githubusercontent.com/otowm/om30-vortex/main/vortex-rascunho-offline.user.js)

Versão **1.4.0**.

- Guarda o rascunho da Nova Visita para sobreviver ao fechamento da aba ou do app.
- Permite reiniciar o horário de início para agora, escolher outro horário (no dia de hoje, até a hora atual) e descartar o rascunho.
- Registra o service worker do Vortex e prepara os arquivos da página para uso offline.
- Em Agendar, abre o formulário de “Novo Agendamento” como modal, em vez de no fim da página. Feche com Esc ou clicando fora.
- Direciona o login para a página de acesso do cliente.
- Mostra o estado do rascunho e do offline na nuvenzinha.

Abra o sistema com internet antes de usar o modo offline, para preparar o cache.

### [Vortex — lançar visita no GLPI](https://raw.githubusercontent.com/otowm/om30-vortex/main/vortex-glpi.user.js)

Versão **1.8.2**.

- Prepara um chamado com os dados da visita, incluindo título, descrição, data, duração, localização, categoria e atores.
- Usa o título “Tipo - Motivo - Unidade”, sem repetir motivo e data no corpo da descrição. Motivos longos são abreviados para respeitar os 255 caracteres do título.
- Oferece o lançamento ao finalizar a visita e no detalhe de uma ficha.
- Abre o GLPI imediatamente, enquanto consulta a ficha no Vortex. A tela fica bloqueada com um indicador de carregamento até o chamado estar pronto para revisão.
- Salva rascunhos do GLPI e permite continuar o preenchimento depois.
- Mostra pendências e vínculos com chamados em Minhas Visitas.
- Inclui “Ficha Vortex: ID”, com o ID clicável. O link filtra o Histórico pela data e pelo nome da unidade; com o script ativo no Vortex, tenta abrir a ficha correspondente.

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
