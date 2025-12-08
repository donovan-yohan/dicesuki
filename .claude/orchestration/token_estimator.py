"""
Token estimation utilities for context budget management.

Provides accurate token counting for orchestration context.
Falls back to character-based estimation if tiktoken not available.
"""

from typing import Any, Dict
import json


class TokenEstimator:
    """
    Estimates token usage for orchestration context.
    
    Uses tiktoken if available, otherwise falls back to improved
    character-based estimation.
    """
    
    def __init__(self, model: str = "cl100k_base"):
        """
        Initialize token estimator.
        
        Args:
            model: Tokenizer model to use (cl100k_base for GPT-4, GPT-3.5-turbo)
        """
        self.tokenizer = None
        self.model = model
        
        # Try to import tiktoken
        try:
            import tiktoken
            self.tokenizer = tiktoken.get_encoding(model)
        except ImportError:
            # tiktoken not available - will use fallback estimation
            pass
    
    def estimate_tokens(self, value: Any) -> int:
        """
        Estimate token count for any value.
        
        Args:
            value: Value to estimate tokens for (str, dict, list, etc.)
        
        Returns:
            Estimated token count
        """
        # Convert value to string representation
        if isinstance(value, str):
            text = value
        elif isinstance(value, (dict, list)):
            # Use compact JSON representation
            text = json.dumps(value, separators=(',', ':'))
        else:
            text = str(value)
        
        # Use tiktoken if available
        if self.tokenizer:
            return len(self.tokenizer.encode(text))
        
        # Otherwise use improved character-based estimation
        return self._fallback_estimate(text)
    
    def _fallback_estimate(self, text: str) -> int:
        """
        Improved character-based token estimation.
        
        Better than naive len(text) // 4 because it accounts for:
        - Whitespace (doesn't consume many tokens)
        - Punctuation (sometimes separate tokens)
        - Code structure (braces, operators)
        
        Args:
            text: Text to estimate
        
        Returns:
            Estimated token count
        """
        # Base character count
        char_count = len(text)
        
        # Count different character types
        whitespace_count = sum(1 for c in text if c.isspace())
        punct_count = sum(1 for c in text if c in '.,;:!?()[]{}')
        word_count = len(text.split())
        
        # Estimation formula (calibrated to GPT tokenizer behavior):
        # - Each word is roughly 1.3 tokens on average
        # - Whitespace is negligible (already counted in words)
        # - Punctuation adds ~0.5 tokens each
        # - Remaining characters are ~4 chars per token
        
        word_tokens = word_count * 1.3
        punct_tokens = punct_count * 0.5
        
        # Use the maximum of word-based or character-based estimate
        # This handles both natural language and code well
        char_based = char_count / 4.0
        word_based = word_tokens + punct_tokens
        
        return int(max(char_based, word_based))
    
    def estimate_dict_tokens(self, data: Dict[str, Any]) -> Dict[str, int]:
        """
        Estimate tokens for each field in a dictionary.
        
        Args:
            data: Dictionary to analyze
        
        Returns:
            Dict mapping field names to token counts
        """
        token_breakdown = {}
        
        for key, value in data.items():
            # Estimate tokens for this field
            # Include the key itself in the count
            key_tokens = self.estimate_tokens(key)
            value_tokens = self.estimate_tokens(value)
            token_breakdown[key] = key_tokens + value_tokens
        
        return token_breakdown
    
    def estimate_total_tokens(self, data: Any) -> int:
        """
        Estimate total tokens for arbitrary data structure.
        
        Args:
            data: Data to estimate
        
        Returns:
            Total estimated token count
        """
        if isinstance(data, dict):
            # Sum tokens for all fields
            breakdown = self.estimate_dict_tokens(data)
            return sum(breakdown.values())
        else:
            # Direct estimation
            return self.estimate_tokens(data)


# Global estimator instance
_estimator = None


def get_estimator() -> TokenEstimator:
    """Get or create global token estimator instance."""
    global _estimator
    if _estimator is None:
        _estimator = TokenEstimator()
    return _estimator


def estimate_tokens(value: Any) -> int:
    """
    Convenience function to estimate tokens for a value.
    
    Args:
        value: Value to estimate
    
    Returns:
        Estimated token count
    """
    return get_estimator().estimate_tokens(value)


def estimate_dict_tokens(data: Dict[str, Any]) -> Dict[str, int]:
    """
    Convenience function to estimate tokens per field.
    
    Args:
        data: Dictionary to analyze
    
    Returns:
        Token breakdown by field
    """
    return get_estimator().estimate_dict_tokens(data)
