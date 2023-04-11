import ApiClient, { ApiUrls } from '../../../src/ApiClient'
import {
  KeyGeneratorKeystoreProvider,
  KeystoreProviderUnavailableError,
} from '../../../src/keystore/providers'
import { Signer } from '../../../src/types/Signer'
import { newWallet } from '../../helpers'
import { testProviderOptions } from './helpers'

describe('KeyGeneratorKeystoreProvider', () => {
  let wallet: Signer
  let apiClient: ApiClient
  beforeEach(() => {
    wallet = newWallet()
    apiClient = new ApiClient(ApiUrls['local'])
  })

  it('creates a key when wallet supplied', async () => {
    const provider = new KeyGeneratorKeystoreProvider()
    const keystore = await provider.newKeystore(
      testProviderOptions(),
      apiClient,
      wallet
    )
    expect(keystore).toBeDefined()
  })

  it('throws KeystoreProviderUnavailableError when no wallet supplied', async () => {
    const provider = new KeyGeneratorKeystoreProvider()
    const prom = provider.newKeystore(
      testProviderOptions(),
      apiClient,
      undefined
    )
    expect(prom).rejects.toThrow(KeystoreProviderUnavailableError)
  })

  it('calls preCreateIdentityNotifier when supplied', async () => {
    const provider = new KeyGeneratorKeystoreProvider()
    const preCreateIdentityNotifier = jest.fn()
    const keystore = await provider.newKeystore(
      { ...testProviderOptions(), preCreateIdentityNotifier },
      apiClient,
      wallet
    )
    expect(keystore).toBeDefined()
    expect(preCreateIdentityNotifier).toHaveBeenCalledTimes(1)
  })
})
