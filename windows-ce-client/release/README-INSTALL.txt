GIVOVA COLETA - SIMULADOR PARA WINDOWS  v{VERSION}
=================================================

Simula o coletor Windows CE no PC: o leitor USB em modo teclado (ou digitacao +
ENTER) funciona como o gatilho do coletor. Use para testes e treinamento.

Requisitos
- Windows 10 ou 11 (inclui o .NET Framework 4.x necessario).
- Acesso a internet para a API (HTTPS / TLS 1.2).

Instalacao
1. Extraia o ZIP para uma pasta do usuario, por exemplo C:\GivovaColeta
   (nao use "Arquivos de Programas": o aplicativo grava a fila em data\).
2. Renomeie collector.ini.example para collector.ini.
3. Edite collector.ini: defina DeviceId (unico por equipamento) e confira ApiBaseUrl.
4. Execute GivovaCollector.exe.
   O Windows SmartScreen pode avisar que o aplicativo nao e assinado:
   clique em "Mais informacoes" > "Executar assim mesmo".
5. Entre com o usuario e senha fornecidos pelo administrador.

Tamanhos de tela: GivovaCollector.exe --size=240x320 | 320x240 | 480x640

Dados locais
- data\scans.journal guarda leituras ainda nao enviadas. NAO apague esta pasta
  enquanto houver pendencias (tela PEND.).
- data\logs\ contem logs de diagnostico (sem senhas).

Verificacao do arquivo
Compare o SHA-256 do ZIP com o exibido na pagina Downloads do painel:
  PowerShell> Get-FileHash .\GivovaCollector-Simulator-v{VERSION}.zip -Algorithm SHA256
