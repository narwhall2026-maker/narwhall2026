#!/usr/bin/env python3
"""Build a signed beta APK using official Android Build Tools and the Eclipse compiler."""
import argparse,json,os,shutil,subprocess,zipfile
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--tools',required=True,type=Path,help='Directory containing android-35, android-15 and ecj.jar')
p.add_argument('--signing',required=True,type=Path,help='Private JSON with keystore, alias and password; never commit')
p.add_argument('--output',required=True,type=Path)
p.add_argument('--version-code',type=int,default=1)
p.add_argument('--version-name',default='0.1.0-beta')
a=p.parse_args();root=Path(__file__).resolve().parent;tools=a.tools.resolve();platform=tools/'android-35';build=tools/'android-15'
if not build.exists():
 choices=[x for x in tools.iterdir() if (x/'aapt2').exists()]
 if len(choices)!=1:raise SystemExit('Cannot locate Android Build Tools')
 build=choices[0]
for binary in ['aapt2','zipalign']:(build/binary).chmod(0o755)
work=root/'app'/'build'/'standalone';shutil.rmtree(work,ignore_errors=True);work.mkdir(parents=True)
classes=work/'classes';classes.mkdir();dex=work/'dex';dex.mkdir();generated=work/'generated';generated.mkdir()
env=os.environ.copy();env['LD_LIBRARY_PATH']=str(build/'lib64')+':/usr/lib/jvm/java-17-openjdk-amd64/lib:'+env.get('LD_LIBRARY_PATH','')
java=shutil.which('java');android=platform/'android.jar'
def run(*args):subprocess.run([str(x) for x in args],env=env,check=True)
run(build/'aapt2','compile','--dir',root/'app/src/main/res','-o',work/'resources.zip')
run(build/'aapt2','link','-o',work/'unsigned.apk','--manifest',root/'app/src/main/AndroidManifest.xml','-I',android,'--java',generated,'--min-sdk-version','26','--target-sdk-version','35','--version-code',a.version_code,'--version-name',a.version_name,work/'resources.zip')
sources=list((root/'app/src/main/java').rglob('*.java'))
run(java,'-jar',tools/'ecj.jar','-source','1.8','-target','1.8','-proc:none','-bootclasspath',str(android)+os.pathsep+str(build/'core-lambda-stubs.jar'),'-warn:none','-d',classes,*sources)
run(java,'-cp',build/'lib/d8.jar','com.android.tools.r8.D8','--lib',android,'--min-api','26','--output',dex,*classes.rglob('*.class'))
with zipfile.ZipFile(work/'unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as archive:
 for f in dex.glob('*.dex'):archive.write(f,f.name)
run(build/'zipalign','-f','4',work/'unsigned.apk',work/'aligned.apk')
config=json.loads(a.signing.read_text());keystore=Path(config['keystore']);keystore=keystore if keystore.is_absolute() else a.signing.resolve().parent/keystore;env['NARWHALL_SIGNING_PASSWORD']=config['password'];a.output.parent.mkdir(parents=True,exist_ok=True)
run(java,'-jar',build/'lib/apksigner.jar','sign','--ks',keystore,'--ks-key-alias',config['alias'],'--ks-pass','env:NARWHALL_SIGNING_PASSWORD','--key-pass','env:NARWHALL_SIGNING_PASSWORD','--out',a.output.resolve(),work/'aligned.apk')
run(java,'-jar',build/'lib/apksigner.jar','verify','--verbose','--print-certs',a.output.resolve())
run(build/'zipalign','-c','4',a.output.resolve())
print('Signed and verified:',a.output.resolve())
