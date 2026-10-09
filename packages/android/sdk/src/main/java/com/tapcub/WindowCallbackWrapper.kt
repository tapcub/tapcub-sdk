package com.tapcub

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.os.Build
import android.view.ActionMode
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.SearchEvent
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent

/** Forwards every Window.Callback method to the wrapped callback. */
internal open class WindowCallbackWrapper(private val inner: Window.Callback) : Window.Callback {
    override fun dispatchKeyEvent(event: KeyEvent): Boolean = inner.dispatchKeyEvent(event)
    override fun dispatchKeyShortcutEvent(event: KeyEvent): Boolean = inner.dispatchKeyShortcutEvent(event)
    override fun dispatchTouchEvent(event: MotionEvent): Boolean = inner.dispatchTouchEvent(event)
    override fun dispatchTrackballEvent(event: MotionEvent): Boolean = inner.dispatchTrackballEvent(event)
    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean = inner.dispatchGenericMotionEvent(event)
    override fun dispatchPopulateAccessibilityEvent(event: AccessibilityEvent): Boolean = inner.dispatchPopulateAccessibilityEvent(event)
    override fun onCreatePanelView(featureId: Int): View? = inner.onCreatePanelView(featureId)
    override fun onCreatePanelMenu(featureId: Int, menu: Menu): Boolean = inner.onCreatePanelMenu(featureId, menu)
    override fun onPreparePanel(featureId: Int, view: View?, menu: Menu): Boolean = inner.onPreparePanel(featureId, view, menu)
    override fun onMenuOpened(featureId: Int, menu: Menu): Boolean = inner.onMenuOpened(featureId, menu)
    override fun onMenuItemSelected(featureId: Int, item: MenuItem): Boolean = inner.onMenuItemSelected(featureId, item)
    override fun onWindowAttributesChanged(attrs: WindowManager.LayoutParams) = inner.onWindowAttributesChanged(attrs)
    override fun onContentChanged() = inner.onContentChanged()
    override fun onWindowFocusChanged(hasFocus: Boolean) = inner.onWindowFocusChanged(hasFocus)
    override fun onAttachedToWindow() = inner.onAttachedToWindow()
    override fun onDetachedFromWindow() = inner.onDetachedFromWindow()
    override fun onPanelClosed(featureId: Int, menu: Menu) = inner.onPanelClosed(featureId, menu)
    override fun onSearchRequested(): Boolean = inner.onSearchRequested()

    @SuppressLint("NewApi")
    override fun onSearchRequested(searchEvent: SearchEvent): Boolean = inner.onSearchRequested(searchEvent)
    override fun onWindowStartingActionMode(callback: ActionMode.Callback): ActionMode? = inner.onWindowStartingActionMode(callback)

    @SuppressLint("NewApi")
    override fun onWindowStartingActionMode(callback: ActionMode.Callback, type: Int): ActionMode? = inner.onWindowStartingActionMode(callback, type)
    override fun onActionModeStarted(mode: ActionMode) = inner.onActionModeStarted(mode)
    override fun onActionModeFinished(mode: ActionMode) = inner.onActionModeFinished(mode)

    @TargetApi(Build.VERSION_CODES.N)
    override fun onProvideKeyboardShortcuts(data: MutableList<KeyboardShortcutGroup>, menu: Menu?, deviceId: Int) =
        inner.onProvideKeyboardShortcuts(data, menu, deviceId)

    @TargetApi(Build.VERSION_CODES.O)
    override fun onPointerCaptureChanged(hasCapture: Boolean) = inner.onPointerCaptureChanged(hasCapture)
}
