package app.narwhall.beta;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/** Small Android host for the live, HTTPS-only Narwhall beta. No JavaScript/native bridge. */
public final class MainActivity extends Activity {
    private static final String START_URL = "https://narwhall.app/";
    private static final int CAMERA_REQUEST = 21, PHOTO_REQUEST = 22;
    private WebView web;
    private boolean navigationFailed;
    private ProgressBar progress;
    private LinearLayout connectionPanel;
    private PermissionRequest cameraRequest;
    private ValueCallback<Uri[]> photoCallback;

    private boolean isTrusted(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
            && "narwhall.app".equalsIgnoreCase(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }
    private boolean isOnNarwhall() { return web != null && isTrusted(Uri.parse(web.getUrl() == null ? "" : web.getUrl())); }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(40,22,55));
        getWindow().setNavigationBarColor(Color.rgb(40,22,55));
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(40,22,55));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left,safe.top,safe.right,safe.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(40,22,55));
        root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only user-selected image content URIs, below.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);

        progress = new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        root.addView(progress,new FrameLayout.LayoutParams(-1,dp(3),Gravity.TOP));
        connectionPanel = new LinearLayout(this);
        connectionPanel.setOrientation(LinearLayout.VERTICAL);
        connectionPanel.setGravity(Gravity.CENTER);
        connectionPanel.setPadding(dp(32),dp(32),dp(32),dp(32));
        connectionPanel.setBackgroundColor(Color.rgb(40,22,55));
        TextView title = new TextView(this);
        title.setText("A little connection break"); title.setTextColor(Color.WHITE);title.setTextSize(24);title.setGravity(Gravity.CENTER);
        TextView hint = new TextView(this);
        hint.setText("Check your internet connection, then try again.");hint.setTextColor(Color.rgb(208,189,223));hint.setTextSize(15);hint.setGravity(Gravity.CENTER);hint.setPadding(0,dp(16),0,dp(20));
        Button retry = new Button(this);retry.setText("Try again");retry.setOnClickListener(v -> {connectionPanel.setVisibility(View.GONE);web.setVisibility(View.VISIBLE);web.loadUrl(START_URL);});
        connectionPanel.addView(title);connectionPanel.addView(hint);connectionPanel.addView(retry);
        root.addView(connectionPanel,new FrameLayout.LayoutParams(-1,-1));connectionPanel.setVisibility(View.GONE);
        setContentView(root);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url=request.getUrl();
                if (!request.isForMainFrame()) return !isTrusted(url);
                if (isTrusted(url)) return false;
                if ("https".equalsIgnoreCase(url.getScheme()) || "mailto".equalsIgnoreCase(url.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW,url)); } catch (ActivityNotFoundException ignored) { Toast.makeText(MainActivity.this,"No app available to open this link",Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) {
                if (cameraRequest != null) {cameraRequest.deny();cameraRequest=null;}
                navigationFailed=false;progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageCommitVisible(WebView view,String url) { if(!navigationFailed && isTrusted(Uri.parse(url))) { connectionPanel.setVisibility(View.GONE);web.setVisibility(View.VISIBLE); } }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error) { if(request.isForMainFrame()) showConnectionPanel(); }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse error) { if(request.isForMainFrame() && error.getStatusCode()>=400) showConnectionPanel(); }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error) { handler.cancel();showConnectionPanel(); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view,int value) {progress.setProgress(value);if(value==100)progress.setVisibility(View.GONE);}
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!isTrusted(request.getOrigin()) || !isOnNarwhall()) {request.deny();return;}
                    boolean video=false;for(String resource:request.getResources())if(PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource))video=true;
                    if (!video) {request.deny();return;}
                    if (cameraRequest!=null)cameraRequest.deny();cameraRequest=request;
                    if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED) grantCamera();
                    else requestPermissions(new String[]{Manifest.permission.CAMERA},CAMERA_REQUEST);
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {if(cameraRequest==request)cameraRequest=null;}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params) {
                if(!isOnNarwhall()){callback.onReceiveValue(null);return true;}
                if(photoCallback!=null)photoCallback.onReceiveValue(null);photoCallback=callback;
                Intent picker=new Intent(Intent.ACTION_OPEN_DOCUMENT);picker.addCategory(Intent.CATEGORY_OPENABLE);picker.setType("image/*");picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {startActivityForResult(picker,PHOTO_REQUEST);} catch(ActivityNotFoundException error){photoCallback.onReceiveValue(null);photoCallback=null;Toast.makeText(MainActivity.this,"No photo picker available",Toast.LENGTH_SHORT).show();}
                return true;
            }
        });
        if(saved==null || web.restoreState(saved)==null)web.loadUrl(START_URL);
    }
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private void showConnectionPanel(){navigationFailed=true;progress.setVisibility(View.GONE);connectionPanel.setVisibility(View.VISIBLE);web.setVisibility(View.INVISIBLE);}
    private void grantCamera(){PermissionRequest request=cameraRequest;cameraRequest=null;if(request==null)return;if(isOnNarwhall()&&isTrusted(request.getOrigin()))request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});else request.deny();}
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){super.onRequestPermissionsResult(code,permissions,results);if(code==CAMERA_REQUEST){if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)grantCamera();else if(cameraRequest!=null){cameraRequest.deny();cameraRequest=null;}}}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==PHOTO_REQUEST&&photoCallback!=null){Uri chosen=result==RESULT_OK&&data!=null?data.getData():null;boolean valid=false;if(chosen!=null&&"content".equals(chosen.getScheme())&&isOnNarwhall()){try{String mime=getContentResolver().getType(chosen);valid=mime!=null&&mime.startsWith("image/");}catch(SecurityException ignored){}}
        photoCallback.onReceiveValue(valid?new Uri[]{chosen}:null);photoCallback=null;
    }}
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);web.saveState(state);CookieManager.getInstance().flush();}
    @Override protected void onPause(){if(web!=null){if(isOnNarwhall()&&cameraRequest==null)web.evaluateJavascript("if(typeof stopHomeCamera==='function')stopHomeCamera();if(document.body.dataset.screen==='pong'&&typeof leaveLivePong==='function')leaveLivePong();",null);web.onPause();CookieManager.getInstance().flush();}super.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null){web.onResume();if(isOnNarwhall())web.evaluateJavascript("if(document.body.dataset.screen==='home'&&typeof resumeHomeCamera==='function')resumeHomeCamera();",null);}}
    @Override public void onBackPressed(){if(connectionPanel.getVisibility()==View.VISIBLE){super.onBackPressed();return;}if(isOnNarwhall()){web.evaluateJavascript("(function(){if(document.getElementById('capturePanel')?.classList.contains('open')&&typeof closeCapture==='function'){closeCapture();return true;}if(document.body.dataset.screen!=='home'&&typeof showScreen==='function'){showScreen('home');return true;}return false;})()",handled->{if(!"true".equals(handled))finish();});}else if(web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(cameraRequest!=null)cameraRequest.deny();if(photoCallback!=null)photoCallback.onReceiveValue(null);if(web!=null){web.stopLoading();web.destroy();}super.onDestroy();}
}
