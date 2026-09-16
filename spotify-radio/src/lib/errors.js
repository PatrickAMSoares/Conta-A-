export class RadioError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export const ERROR_MESSAGES = {
  NOT_CONNECTED: 'Você ainda não conectou sua conta do Spotify.',
  TOKEN_EXPIRED: 'Sua sessão do Spotify expirou. Conecte novamente para continuar.',
  PREMIUM_REQUIRED:
    'Essa função exige uma conta Spotify Premium. Contas gratuitas não podem reproduzir músicas completas pelo navegador.',
  TRACK_UNAVAILABLE: 'Essa música não está disponível para reprodução na sua conta ou região.',
  API_UNAVAILABLE: 'O Spotify está temporariamente indisponível. Tente novamente em alguns instantes.',
  NO_TRACKS_FOUND:
    'Não encontramos músicas suficientes com as fontes selecionadas. Tente ativar outras opções em "Configurar Rádio".',
  PLAYBACK_FAILED:
    'Não foi possível iniciar a reprodução. Verifique se sua conta Spotify possui os requisitos necessários para reprodução pelo navegador.',
  AUTH_FAILED: 'Não foi possível concluir a autenticação com o Spotify. Tente conectar novamente.',
  GENERIC: 'Algo deu errado. Tente novamente.',
}
