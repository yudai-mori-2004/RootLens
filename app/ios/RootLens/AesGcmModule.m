#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AesGcmBridge, NSObject)

RCT_EXTERN_METHOD(buildAndEncryptPayload:(NSString *)contentFilePath
                  metadataJson:(NSString *)metadataJson
                  requestKeyBase64:(NSString *)requestKeyBase64
                  encapKeyBase64:(NSString *)encapKeyBase64
                  aadString:(NSString *)aadString
                  outputFilePath:(NSString *)outputFilePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(encryptFile:(NSString *)inputPath
                  outputPath:(NSString *)outputPath
                  keyBase64:(NSString *)keyBase64
                  aadBase64:(NSString *)aadBase64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(decryptFile:(NSString *)inputPath
                  outputPath:(NSString *)outputPath
                  keyBase64:(NSString *)keyBase64
                  nonceBase64:(NSString *)nonceBase64
                  aadBase64:(NSString *)aadBase64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
