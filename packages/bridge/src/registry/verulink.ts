/** Pins the public ALEO deployment to the reviewed BSC-specific upstream revision. */
export const VERULINK_SOURCE = 'https://github.com/venture23-aleo/verulink/tree/4307bfbdf414a84205ec426d5bddc1dff0a2ebfc'
/** Defines independent Verulink domains, peer services, token locators, and finality policy. */
export const VERULINK_METADATA = {
  registryCommit: '4307bfbdf414a84205ec426d5bddc1dff0a2ebfc',
  evmChainId: 56,
  evmDomain: '422842677816',
  aleoDomain: '6694886634401',
  evmTokenService: '0x4752397298793a7db886bEfC6c8E38729D269744',
  evmBridge: '0x397e47F5072B48681b170199551bdB7fBDa136b7',
  evmToken: '0x6CFfFa5bFD4277a04D83307fEedFe2D18D944DD2',
  aleoTokenService: 'vlink_token_service_cd_v3.aleo',
  aleoServiceAddress: 'aleo1er7zejft45vajxr7q0v44n4mw0v32ac6jww7xulnyzpur0wuygzq2atznq',
  aleoBridge: 'vlink_token_bridge_v3.aleo',
  aleoTokenId: '3443843282313283355522573239085696902919850365217539366784739393210722344986field',
  collectorUrl: 'https://alb-backend-mainnet.verulink.com/v2',
  sourceConfirmations: 15,
} as const
