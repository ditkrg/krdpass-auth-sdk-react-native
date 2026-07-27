package krdpass.auth.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Autolinking entry point for the Codegen TurboModule. */
class KrdpassAuthReactNativePackage : BaseReactPackage() {
  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? = when (name) {
    KrdpassAuthReactNativeModule.NAME -> KrdpassAuthReactNativeModule(reactContext)
    else -> null
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      KrdpassAuthReactNativeModule.NAME to ReactModuleInfo(
        KrdpassAuthReactNativeModule.NAME,
        KrdpassAuthReactNativeModule::class.java.name,
        false,
        false,
        false,
        true,
      ),
    )
  }
}
